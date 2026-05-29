"use client";

import { getOperateIx, MIN_I128 } from "@jup-ag/lend/borrow";

// NOTE: MIN_I128 is sentinel for both colAmount (withdraw all) and
// debtAmount (repay all).

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  SystemProgram,
  type AddressLookupTableAccount,
  type Connection,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface PrepareJupLendCreateParams {
  vaultId: number;
  collateralMint: string;
  debtMint: string;
  /** Raw collateral amount in token base units (already scaled by decimals). */
  collateralAmountRaw: BN;
  /** Raw debt amount; pass new BN(0) for supply-only positions. */
  debtAmountRaw: BN;
  walletPublicKey: PublicKey;
  connection: Connection;
}

export interface PreparedTx {
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}

export async function prepareJupLendCreatePosition({
  vaultId,
  collateralMint,
  debtMint,
  collateralAmountRaw,
  debtAmountRaw,
  walletPublicKey,
  connection,
}: PrepareJupLendCreateParams): Promise<PreparedTx> {
  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  const isCollateralSol = collateralMint === SOL_MINT;
  const isDebtSol = debtMint === SOL_MINT;

  if (isCollateralSol || isDebtSol) {
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, walletPublicKey);

    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        wsolAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
    );

    if (isCollateralSol && collateralAmountRaw.gt(new BN(0))) {
      // Wrap colAmount + 1 lamport: JupLend's on-chain Operate runs
      // share-conversion math that rounds the actual transfer up by one
      // atomic unit, so a wrap of exactly colAmount fails TransferChecked
      // with 0x1. The extra lamport is refunded by the close ix below.
      const wrapAmount = collateralAmountRaw.add(new BN(1));

      preIxs.push(
        SystemProgram.transfer({
          fromPubkey: walletPublicKey,
          toPubkey: wsolAta,
          lamports: BigInt(wrapAmount.toString()),
        }),
        createSyncNativeInstruction(wsolAta),
      );
    }

    postIxs.push(
      createCloseAccountInstruction(wsolAta, walletPublicKey, walletPublicKey),
    );
  }

  const { ixs, addressLookupTableAccounts } = await getOperateIx({
    vaultId,
    positionId: 0,
    colAmount: collateralAmountRaw,
    debtAmount: debtAmountRaw,
    signer: walletPublicKey,
    positionOwner: walletPublicKey,
    connection,
  });

  return {
    instructions: [...preIxs, ...ixs, ...postIxs],
    lookupTables: addressLookupTableAccounts,
  };
}

export interface PrepareJupLendUpdateParams {
  positionId: number;
  vaultId: number;
  collateralMint: string;
  debtMint: string;
  // positive = supply, negative = withdraw, BN(0) = no-op, Ignored when withdrawAll is true.
  colAmountSigned: BN;
  // positive = borrow, negative = repay, BN(0) = no-op, Ignored when repayAll is true.
  debtAmountSigned: BN;
  withdrawAll?: boolean;
  repayAll?: boolean;
  currentDebtRawForWrap?: BN;
  walletPublicKey: PublicKey;
  connection: Connection;
}

// Universal update for an existing JupLend position. Supply/withdraw/borrow/
// repay (and any combination, e.g. supply+borrow) all flow through the same
// Operate ix, only the signs of colAmount/debtAmount change.
export async function prepareJupLendUpdatePosition({
  positionId,
  vaultId,
  collateralMint,
  debtMint,
  colAmountSigned,
  debtAmountSigned,
  withdrawAll = false,
  repayAll = false,
  currentDebtRawForWrap,
  walletPublicKey,
  connection,
}: PrepareJupLendUpdateParams): Promise<PreparedTx> {
  if (positionId <= 0) {
    throw new Error(
      "prepareJupLendUpdatePosition requires an existing positionId (>0). Use prepareJupLendCreatePosition for new positions.",
    );
  }

  // Resolve the actual amounts sent to the program. we use sentinel for both legs.
  const colAmount = withdrawAll ? MIN_I128 : colAmountSigned;
  const debtAmount = repayAll ? MIN_I128 : debtAmountSigned;

  if (
    !withdrawAll &&
    !repayAll &&
    colAmountSigned.isZero() &&
    debtAmountSigned.isZero()
  ) {
    throw new Error("At least one of colAmount / debtAmount must be non-zero.");
  }

  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  const isCollateralSol = collateralMint === SOL_MINT;
  const isDebtSol = debtMint === SOL_MINT;

  // Direction flags. Sentinel paths force the corresponding direction.
  const isSupplyingCol = !withdrawAll && colAmountSigned.gt(new BN(0));
  const isWithdrawingCol = withdrawAll || colAmountSigned.lt(new BN(0));
  const isBorrowingDebt = !repayAll && debtAmountSigned.gt(new BN(0));
  const isRepayingDebt = repayAll || debtAmountSigned.lt(new BN(0));

  const needsWsolAta =
    (isCollateralSol && (isSupplyingCol || isWithdrawingCol)) ||
    (isDebtSol && (isBorrowingDebt || isRepayingDebt));

  if (needsWsolAta) {
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, walletPublicKey);

    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        wsolAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
    );

    if (isCollateralSol && isSupplyingCol) {
      const wrapAmount = colAmountSigned.add(new BN(1));
      preIxs.push(
        SystemProgram.transfer({
          fromPubkey: walletPublicKey,
          toPubkey: wsolAta,
          lamports: BigInt(wrapAmount.toString()),
        }),
        createSyncNativeInstruction(wsolAta),
      );
    }

    if (isDebtSol && isRepayingDebt) {
      let wrapAmount: BN;
      if (repayAll) {
        if (!currentDebtRawForWrap || currentDebtRawForWrap.lte(new BN(0))) {
          throw new Error(
            "currentDebtRawForWrap is required (and must be > 0) when repaying full SOL debt.",
          );
        }
        const buffer = currentDebtRawForWrap.divn(1000).add(new BN(10_000));
        wrapAmount = currentDebtRawForWrap.add(buffer);
      } else {
        wrapAmount = debtAmountSigned.neg().add(new BN(1));
      }
      preIxs.push(
        SystemProgram.transfer({
          fromPubkey: walletPublicKey,
          toPubkey: wsolAta,
          lamports: BigInt(wrapAmount.toString()),
        }),
        createSyncNativeInstruction(wsolAta),
      );
    }

    postIxs.push(
      createCloseAccountInstruction(wsolAta, walletPublicKey, walletPublicKey),
    );
  }

  const { ixs, addressLookupTableAccounts } = await getOperateIx({
    vaultId,
    positionId,
    colAmount,
    debtAmount,
    signer: walletPublicKey,
    positionOwner: walletPublicKey,
    connection,
  });

  return {
    instructions: [...preIxs, ...ixs, ...postIxs],
    lookupTables: addressLookupTableAccounts,
  };
}
