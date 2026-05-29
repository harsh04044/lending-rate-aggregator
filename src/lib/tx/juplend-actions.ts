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
import type { JuplendPairPosition } from "@/app/(dashboard)/protocols/[slug]/page";
import { prepareJupLendUpdatePosition } from "@/src/lib/tx/juplend";
import { sendV0Tx, type SentTx } from "@/src/lib/tx/send";
import { toRawAmount } from "@/src/lib/tx/amount";
import { InsufficientDebtBalanceError } from "@/src/lib/tx/action-errors";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Shape of `JuplendPairPosition.meta` for a JupLend pair. Populated by
// buildPairs() in src/lib/api/protocol.ts.
interface JuplendPairMeta {
  positionId: number;
  vaultId: number;
}

export type JuplendPairTab = "supply-borrow" | "repay-withdraw";

export interface JuplendActionInputs {
  supply: string;
  withdraw: string;
  borrow: string;
  repay: string;
}

export interface JuplendActionFlags {
  withdrawIsMax: boolean;
  repayIsMax: boolean;
}

export interface SubmitJuplendPairActionArgs {
  pair: JuplendPairPosition;
  pairTab: JuplendPairTab;
  inputs: JuplendActionInputs;
  flags: JuplendActionFlags;
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  connection: Connection;
}

// Mirror of fmtNum (`maximumFractionDigits: 2`) used by the API layer when
// rendering amounts. We need it here so that "user typed what they see"
// auto-promotes to the MIN_I128 sentinel — the displayed amount is rounded
// while the on-chain amount has more precision.
function roundedDisplayed(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return parseFloat(n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
}

function parseAmt(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Single submit entry point for JupLend pair actions
// (supply / withdraw / borrow / repay, plus combos).
//
// Throws InsufficientDebtBalanceError when the wallet can't cover a full
// repay — the modal renders that as a structured banner. Any other failure
// throws a plain Error.
export async function submitJuplendPairAction(
  args: SubmitJuplendPairActionArgs,
): Promise<SentTx> {
  const {
    pair,
    pairTab,
    inputs,
    flags,
    publicKey,
    signTransaction,
    connection,
  } = args;

  const meta = pair.meta as JuplendPairMeta | undefined;
  if (!meta?.positionId || !meta?.vaultId) {
    throw new Error("JupLend position meta is missing.");
  }

  const colDecimals = pair.collateralDecimals;
  const debtDecimals = pair.debtDecimals;

  // Resolve the signed amounts. Tab determines direction; auto-promote to
  // MIN_I128 sentinel when the user typed an amount >= what they see (the
  // displayed amount is fmtNum-rounded; matching it usually means "max").
  // Without auto-promote a literal partial repay/withdraw would leave dust
  // below JupLend's MIN_BORROW floor and trip VaultUserDebtTooLow.
  let colSigned: BN;
  let debtSigned: BN;
  let withdrawAll = false;
  let repayAll = false;

  if (pairTab === "supply-borrow") {
    colSigned = toRawAmount(inputs.supply, colDecimals);
    debtSigned = toRawAmount(inputs.borrow, debtDecimals);
  } else {
    const displayedDebt = roundedDisplayed(pair.debtAmount);
    const displayedCol = roundedDisplayed(pair.collateralAmount);
    const typedRepay = parseAmt(inputs.repay);
    const typedWithdraw = parseAmt(inputs.withdraw);

    // Auto-promote only when there's actually something to compare against
    // (`displayedX > 0`) — protects against a 0-balance row where typing
    // nothing would otherwise satisfy `0 >= 0` and silently promote to a
    // sentinel against an empty position.
    if (
      flags.withdrawIsMax ||
      (displayedCol > 0 && typedWithdraw >= displayedCol)
    ) {
      withdrawAll = true;
      colSigned = new BN(0);
    } else {
      colSigned = toRawAmount(inputs.withdraw, colDecimals).neg();
    }
    if (
      flags.repayIsMax ||
      (displayedDebt > 0 && typedRepay >= displayedDebt)
    ) {
      repayAll = true;
      debtSigned = new BN(0);
    } else {
      debtSigned = toRawAmount(inputs.repay, debtDecimals).neg();
    }
  }

  if (
    !withdrawAll &&
    !repayAll &&
    colSigned.isZero() &&
    debtSigned.isZero()
  ) {
    throw new Error("Enter a non-zero amount.");
  }

  const isDebtSol = pair.debtMint === SOL_MINT;

  // Repay-all of SOL debt: needs a buffered wrap amount because the exact
  // on-chain debt at tx-build time is unknown.
  const currentDebtRawForWrap =
    repayAll && isDebtSol
      ? toRawAmount(String(pair.debtAmount), debtDecimals)
      : undefined;

  // Pre-flight wallet balance check for repay-all of non-SOL debt. The on-
  // chain program pulls ceil(actual_debt_at_execution_time), which equals
  // displayedDebt + a tiny amount of accrued interest. If the ATA is short
  // by even 1 atomic unit, TransferChecked fails with raw 0x1 — surface a
  // structured error instead.
  if (repayAll && !isDebtSol) {
    const debtMintPk = new PublicKey(pair.debtMint);
    const debtAta = getAssociatedTokenAddressSync(debtMintPk, publicKey);
    const debtAccount = await getAccount(connection, debtAta).catch(
      () => null,
    );
    const ataBalance = debtAccount
      ? new BN(debtAccount.amount.toString())
      : new BN(0);
    const displayedDebtRaw = toRawAmount(
      String(pair.debtAmount),
      debtDecimals,
    );
    // 1 bp + 100 atomic-unit floor. For ~5% APY this covers many minutes of
    // accrual; the floor handles tiny positions where 1 bp rounds to 0.
    const accrualBuffer = BN.max(displayedDebtRaw.divn(10000), new BN(100));
    const requiredMin = displayedDebtRaw.add(accrualBuffer);
    if (ataBalance.lt(requiredMin)) {
      const have = Number(ataBalance.toString()) / 10 ** debtDecimals;
      const debtNow =
        Number(displayedDebtRaw.toString()) / 10 ** debtDecimals;
      const shortfall = Math.max(0, debtNow - have) + 0.0001;
      const safePartial = Math.max(0, debtNow - 0.001);
      throw new InsufficientDebtBalanceError({
        kind: "insufficient-debt-balance",
        symbol: pair.debtSymbol,
        walletAmount: have.toFixed(debtDecimals),
        debtAmount: debtNow.toFixed(debtDecimals),
        topUpAmount: shortfall.toFixed(debtDecimals),
        partialRepayAmount: safePartial.toFixed(debtDecimals),
      });
    }
  }

  const prepared = await prepareJupLendUpdatePosition({
    positionId: meta.positionId,
    vaultId: meta.vaultId,
    collateralMint: pair.collateralMint,
    debtMint: pair.debtMint,
    colAmountSigned: colSigned,
    debtAmountSigned: debtSigned,
    withdrawAll,
    repayAll,
    currentDebtRawForWrap,
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
