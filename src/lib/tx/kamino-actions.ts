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
  prepareKaminoSupply,
  prepareKaminoWithdraw,
  prepareKaminoBorrow,
  prepareKaminoRepay,
} from "@/src/lib/tx/kamino";
import { sendV0Tx, type SentTx } from "@/src/lib/tx/send";
import { toRawAmount } from "@/src/lib/tx/amount";
import { InsufficientDebtBalanceError } from "@/src/lib/tx/action-errors";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Shape of `meta` for a Kamino collateral / debt row. Set by the savings
// route from per-position meta (marketAddress) merged with per-asset meta
// (reserveAddress). Both are needed: marketAddress to pick the obligation,
// mint (already on the asset) to pick the reserve inside it.
interface KaminoAssetMeta {
  marketAddress: string;
  reserveAddress: string;
}

export interface KaminoActionInputs {
  supply: string;
  withdraw: string;
  borrow: string;
  repay: string;
}

export interface KaminoActionFlags {
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

export interface SubmitKaminoCollateralActionArgs extends SignerProps {
  asset: CollateralAsset;
  inputs: Pick<KaminoActionInputs, "supply" | "withdraw">;
  flags: Pick<KaminoActionFlags, "withdrawIsMax">;
}

export interface SubmitKaminoDebtActionArgs extends SignerProps {
  asset: DebtAsset;
  inputs: Pick<KaminoActionInputs, "borrow" | "repay">;
  flags: Pick<KaminoActionFlags, "repayIsMax">;
}

// Mirror of fmtNum (`maximumFractionDigits: 2`) used by the API layer.
// Lets "user typed what they see" auto-promote to the U64_MAX sentinel,
// matching the JupLend pattern.
function roundedDisplayed(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return parseFloat(n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
}

function parseAmt(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readKaminoMeta(
  meta: Record<string, unknown> | undefined,
): KaminoAssetMeta {
  const marketAddress =
    typeof meta?.marketAddress === "string" ? meta.marketAddress : null;
  const reserveAddress =
    typeof meta?.reserveAddress === "string" ? meta.reserveAddress : null;
  if (!marketAddress || !reserveAddress) {
    throw new Error("Kamino asset meta is missing marketAddress / reserveAddress.");
  }
  return { marketAddress, reserveAddress };
}

// ── Collateral actions: supply / withdraw ────────────────────────────────

export async function submitKaminoCollateralAction(
  args: SubmitKaminoCollateralActionArgs,
): Promise<SentTx> {
  const { asset, inputs, flags, publicKey, signTransaction, connection } = args;
  const meta = readKaminoMeta(asset.meta);
  const decimals = asset.decimals;

  const supplyRaw = toRawAmount(inputs.supply, decimals);
  const typedWithdraw = parseAmt(inputs.withdraw);
  const displayedBalance = roundedDisplayed(asset.balance);

  // Auto-promote: typed >= displayed → withdraw all (sentinel). The
  // displayed amount is fmtNum-rounded; matching it usually means "max",
  // and a literal partial would otherwise leave dust below MIN_BORROW.
  // Guard against a 0-balance row where typing nothing would satisfy
  // `0 >= 0` and silently promote to a sentinel against an empty row.
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

  const prepared = !supplyRaw.isZero()
    ? await prepareKaminoSupply({
        marketAddress: meta.marketAddress,
        mint: asset.mint,
        amountRaw: supplyRaw,
        walletPublicKey: publicKey,
        connection,
      })
    : await prepareKaminoWithdraw({
        marketAddress: meta.marketAddress,
        mint: asset.mint,
        amountRaw: withdrawRaw,
        useFullAmount: withdrawAll,
        walletPublicKey: publicKey,
        connection,
      });

  return sendV0Tx({
    connection,
    signer: { publicKey, signTransaction },
    instructions: prepared.instructions,
    lookupTables: prepared.lookupTables,
  });
}

// ── Debt actions: borrow / repay ─────────────────────────────────────────

export async function submitKaminoDebtAction(
  args: SubmitKaminoDebtActionArgs,
): Promise<SentTx> {
  const { asset, inputs, flags, publicKey, signTransaction, connection } = args;
  const meta = readKaminoMeta(asset.meta);
  const decimals = asset.decimals;

  const borrowRaw = toRawAmount(inputs.borrow, decimals);
  const typedRepay = parseAmt(inputs.repay);
  const displayedDebt = roundedDisplayed(asset.borrowed);

  // Same auto-promote logic as the collateral side, with the same
  // 0-balance guard. See submitKaminoCollateralAction for context.
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

  // Pre-flight wallet balance check for repay-all of non-SOL debt — Kamino
  // pulls ceil(actual_debt_at_execution_time) on U64_MAX, so the wallet
  // must hold the full debt + tiny accrual buffer or the on-chain
  // TransferChecked fails with raw 0x1.
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

  const prepared = !borrowRaw.isZero()
    ? await prepareKaminoBorrow({
        marketAddress: meta.marketAddress,
        mint: asset.mint,
        amountRaw: borrowRaw,
        walletPublicKey: publicKey,
        connection,
      })
    : await prepareKaminoRepay({
        marketAddress: meta.marketAddress,
        mint: asset.mint,
        amountRaw: repayRaw,
        useFullAmount: repayAll,
        walletPublicKey: publicKey,
        connection,
      });

  return sendV0Tx({
    connection,
    signer: { publicKey, signTransaction },
    instructions: prepared.instructions,
    lookupTables: prepared.lookupTables,
  });
}
