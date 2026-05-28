"use client";

import {
  PublicKey,
  type Connection,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import type {
  CollateralAsset,
  DebtAsset,
} from "@/app/(dashboard)/protocols/[slug]/page";
import {
  prepareSaveSupply,
  prepareSaveWithdraw,
  prepareSaveBorrow,
  prepareSaveRepay,
  type SaveReserveDescriptor,
} from "@/src/lib/tx/save";
import { sendV0Tx, type SentTx } from "@/src/lib/tx/send";
import { toRawAmount } from "@/src/lib/tx/amount";
import { InsufficientDebtBalanceError } from "@/src/lib/tx/action-errors";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Shape of the per-asset meta for a Save row. Built by the savings route
// from the source NormalizedPosition's meta (poolAddress / authorityAddress
// / lookupTableAddress / allReserves) merged with the asset's own
// reserveAddress.
interface SaveAssetMeta {
  poolAddress: string;
  authorityAddress: string;
  lookupTableAddress?: string;
  reserveAddress: string;
  allReserves: SaveReserveDescriptor[];
}

export interface SaveActionInputs {
  supply: string;
  withdraw: string;
  borrow: string;
  repay: string;
}

export interface SaveActionFlags {
  withdrawIsMax: boolean;
  repayIsMax: boolean;
}

interface SignerProps {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  connection: Connection;
}

export interface SubmitSaveCollateralActionArgs extends SignerProps {
  asset: CollateralAsset;
  inputs: Pick<SaveActionInputs, "supply" | "withdraw">;
  flags: Pick<SaveActionFlags, "withdrawIsMax">;
}

export interface SubmitSaveDebtActionArgs extends SignerProps {
  asset: DebtAsset;
  inputs: Pick<SaveActionInputs, "borrow" | "repay">;
  flags: Pick<SaveActionFlags, "repayIsMax">;
}

// Mirror of fmtNum (`maximumFractionDigits: 2`). Used so "user typed what
// they see" auto-promotes to the U64_MAX sentinel.
function roundedDisplayed(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return parseFloat(n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
}

function parseAmt(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readSaveMeta(
  meta: Record<string, unknown> | undefined,
): SaveAssetMeta {
  const poolAddress =
    typeof meta?.poolAddress === "string" ? meta.poolAddress : null;
  const authorityAddress =
    typeof meta?.authorityAddress === "string" ? meta.authorityAddress : null;
  const reserveAddress =
    typeof meta?.reserveAddress === "string" ? meta.reserveAddress : null;
  const allReserves = Array.isArray(meta?.allReserves)
    ? (meta.allReserves as SaveReserveDescriptor[])
    : null;
  if (!poolAddress || !authorityAddress || !reserveAddress || !allReserves) {
    throw new Error(
      "Save asset meta is missing pool / authority / reserve / allReserves.",
    );
  }
  const lookupTableAddress =
    typeof meta?.lookupTableAddress === "string"
      ? meta.lookupTableAddress
      : undefined;
  return {
    poolAddress,
    authorityAddress,
    lookupTableAddress,
    reserveAddress,
    allReserves,
  };
}

function findReserve(
  allReserves: SaveReserveDescriptor[],
  reserveAddress: string,
): SaveReserveDescriptor {
  const r = allReserves.find((x) => x.address === reserveAddress);
  if (!r) {
    throw new Error(
      `Save reserve ${reserveAddress} not found in allReserves payload.`,
    );
  }
  return r;
}

// ── Collateral actions: supply / withdraw ────────────────────────────────

export async function submitSaveCollateralAction(
  args: SubmitSaveCollateralActionArgs,
): Promise<SentTx> {
  const { asset, inputs, flags, publicKey, signTransaction, connection } = args;
  const meta = readSaveMeta(asset.meta);
  const reserve = findReserve(meta.allReserves, meta.reserveAddress);
  const decimals = asset.decimals;

  const supplyRaw = toRawAmount(inputs.supply, decimals);
  const typedWithdraw = parseAmt(inputs.withdraw);
  const displayedBalance = roundedDisplayed(asset.balance);

  // Auto-promote to U64_MAX when typed equals/exceeds displayed (with the
  // 0-balance guard from the JupLend / Kamino review pass).
  const withdrawAll =
    flags.withdrawIsMax ||
    (displayedBalance > 0 && typedWithdraw >= displayedBalance);
  const withdrawRaw = withdrawAll
    ? new BN(0)
    : toRawAmount(inputs.withdraw, decimals);

  if (supplyRaw.isZero() && !withdrawAll && withdrawRaw.isZero()) {
    throw new Error("Enter a non-zero amount.");
  }
  if (!supplyRaw.isZero() && (withdrawAll || !withdrawRaw.isZero())) {
    throw new Error(
      "Pick either supply or withdraw — both can't be set on the same submit.",
    );
  }

  const baseParams = {
    poolAddress: meta.poolAddress,
    authorityAddress: meta.authorityAddress,
    lookupTableAddress: meta.lookupTableAddress,
    reserve,
    allReserves: meta.allReserves,
    walletPublicKey: publicKey,
    connection,
  };

  const prepared = !supplyRaw.isZero()
    ? await prepareSaveSupply({ ...baseParams, amountRaw: supplyRaw })
    : await prepareSaveWithdraw({
        ...baseParams,
        amountRaw: withdrawRaw,
        useFullAmount: withdrawAll,
      });

  return sendV0Tx({
    connection,
    signer: { publicKey, signTransaction },
    instructions: prepared.instructions,
    lookupTables: prepared.lookupTables,
  });
}

// ── Debt actions: borrow / repay ─────────────────────────────────────────

export async function submitSaveDebtAction(
  args: SubmitSaveDebtActionArgs,
): Promise<SentTx> {
  const { asset, inputs, flags, publicKey, signTransaction, connection } = args;
  const meta = readSaveMeta(asset.meta);
  const reserve = findReserve(meta.allReserves, meta.reserveAddress);
  const decimals = asset.decimals;

  const borrowRaw = toRawAmount(inputs.borrow, decimals);
  const typedRepay = parseAmt(inputs.repay);
  const displayedDebt = roundedDisplayed(asset.borrowed);

  const repayAll =
    flags.repayIsMax ||
    (displayedDebt > 0 && typedRepay >= displayedDebt);
  const repayRaw = repayAll
    ? new BN(0)
    : toRawAmount(inputs.repay, decimals);

  if (borrowRaw.isZero() && !repayAll && repayRaw.isZero()) {
    throw new Error("Enter a non-zero amount.");
  }
  if (!borrowRaw.isZero() && (repayAll || !repayRaw.isZero())) {
    throw new Error(
      "Pick either borrow or repay — both can't be set on the same submit.",
    );
  }

  // Pre-flight wallet balance check for repay-all of non-SOL debt.
  if (repayAll && asset.mint !== SOL_MINT) {
    const debtMintPk = new PublicKey(asset.mint);
    const debtAta = getAssociatedTokenAddressSync(debtMintPk, publicKey);
    const debtAccount = await getAccount(connection, debtAta).catch(() => null);
    const ataBalance = debtAccount
      ? new BN(debtAccount.amount.toString())
      : new BN(0);
    const displayedDebtRaw = toRawAmount(String(asset.borrowed), decimals);
    const accrualBuffer = BN.max(displayedDebtRaw.divn(10000), new BN(100));
    const requiredMin = displayedDebtRaw.add(accrualBuffer);
    if (ataBalance.lt(requiredMin)) {
      const have = Number(ataBalance.toString()) / 10 ** decimals;
      const debtNow = Number(displayedDebtRaw.toString()) / 10 ** decimals;
      const shortfall = Math.max(0, debtNow - have) + 0.0001;
      const safePartial = Math.max(0, debtNow - 0.001);
      throw new InsufficientDebtBalanceError({
        kind: "insufficient-debt-balance",
        symbol: asset.symbol,
        walletAmount: have.toFixed(decimals),
        debtAmount: debtNow.toFixed(decimals),
        topUpAmount: shortfall.toFixed(decimals),
        partialRepayAmount: safePartial.toFixed(decimals),
      });
    }
  }

  const baseParams = {
    poolAddress: meta.poolAddress,
    authorityAddress: meta.authorityAddress,
    lookupTableAddress: meta.lookupTableAddress,
    reserve,
    allReserves: meta.allReserves,
    walletPublicKey: publicKey,
    connection,
  };

  let prepared;
  if (!borrowRaw.isZero()) {
    prepared = await prepareSaveBorrow({ ...baseParams, amountRaw: borrowRaw });
  } else {
    // For SOL repay-all, prepareSaveRepay needs the displayed debt as
    // amountRaw to size the wsol wrap. For partial SOL or any non-SOL,
    // amountRaw is the actual repay amount.
    const amountRawForRepay =
      repayAll && asset.mint === SOL_MINT
        ? toRawAmount(String(asset.borrowed), decimals)
        : repayRaw;
    prepared = await prepareSaveRepay({
      ...baseParams,
      amountRaw: amountRawForRepay,
      useFullAmount: repayAll,
    });
  }

  return sendV0Tx({
    connection,
    signer: { publicKey, signTransaction },
    instructions: prepared.instructions,
    lookupTables: prepared.lookupTables,
  });
}
