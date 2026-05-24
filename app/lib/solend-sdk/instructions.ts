import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import BufferLayout from "buffer-layout";
import * as Layout from "./buffer-layout";

export enum LendingInstruction {
  InitLendingMarket = 0,
  SetLendingMarketOwnerAndConfig = 1,
  InitReserve = 2,
  RefreshReserve = 3,
  DepositReserveLiquidity = 4,
  RedeemReserveCollateral = 5,
  InitObligation = 6,
  RefreshObligation = 7,
  DepositObligationCollateral = 8,
  WithdrawObligationCollateral = 9,
  BorrowObligationLiquidity = 10,
  RepayObligationLiquidity = 11,
  LiquidateObligation = 12,
  FlashLoan = 13,
  DepositReserveLiquidityAndObligationCollateral = 14,
  WithdrawObligationCollateralAndRedeemReserveLiquidity = 15,
  UpdateReserveConfig = 16,
  LiquidateObligationAndRedeemReserveCollateral = 17,
  RedeemFees = 18,
  FlashBorrowReserveLiquidity = 19,
  FlashRepayReserveLiquidity = 20,
  ForgiveDebt = 21,
  UpdateMetadata = 22,
  SetObligationCloseabilityStatus = 23,
}

// ─── Init Obligation ─────────────────────────────────────────────────────────

export const initObligationInstruction = (
  obligation: PublicKey,
  lendingMarket: PublicKey,
  obligationOwner: PublicKey,
  solendProgramAddress: PublicKey,
): TransactionInstruction => {
  const dataLayout = BufferLayout.struct([BufferLayout.u8("instruction")]);
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode({ instruction: LendingInstruction.InitObligation }, data);
  const keys = [
    { pubkey: obligation, isSigner: false, isWritable: true },
    { pubkey: lendingMarket, isSigner: false, isWritable: false },
    { pubkey: obligationOwner, isSigner: true, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    keys,
    programId: solendProgramAddress,
    data,
  });
};

// ─── Refresh Reserve ─────────────────────────────────────────────────────────

export const refreshReserveInstruction = (
  reserve: PublicKey,
  solendProgramAddress: PublicKey,
  oracle: PublicKey,
  switchboardFeedAddress?: PublicKey,
  extraOracle?: PublicKey,
): TransactionInstruction => {
  const dataLayout = BufferLayout.struct([BufferLayout.u8("instruction")]);
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode({ instruction: LendingInstruction.RefreshReserve }, data);
  const keys = [{ pubkey: reserve, isSigner: false, isWritable: true }];
  keys.push({ pubkey: oracle, isSigner: false, isWritable: false });
  if (switchboardFeedAddress) {
    keys.push({
      pubkey: switchboardFeedAddress,
      isSigner: false,
      isWritable: false,
    });
  }
  if (extraOracle) {
    keys.push({
      pubkey: extraOracle,
      isSigner: false,
      isWritable: false,
    });
  }
  return new TransactionInstruction({
    keys,
    programId: solendProgramAddress,
    data,
  });
};

// ─── Refresh Obligation ──────────────────────────────────────────────────────

export const refreshObligationInstruction = (
  obligation: PublicKey,
  depositReserves: PublicKey[],
  borrowReserves: PublicKey[],
  solendProgramAddress: PublicKey,
): TransactionInstruction => {
  const dataLayout = BufferLayout.struct([BufferLayout.u8("instruction")]);
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    { instruction: LendingInstruction.RefreshObligation },
    data,
  );
  const keys = [{ pubkey: obligation, isSigner: false, isWritable: true }];
  depositReserves.forEach((depositReserve) =>
    keys.push({
      pubkey: depositReserve,
      isSigner: false,
      isWritable: false,
    }),
  );
  borrowReserves.forEach((borrowReserve) =>
    keys.push({
      pubkey: borrowReserve,
      isSigner: false,
      isWritable: false,
    }),
  );
  return new TransactionInstruction({
    keys,
    programId: solendProgramAddress,
    data,
  });
};

// ─── Deposit Reserve Liquidity And Obligation Collateral ─────────────────────

export const depositReserveLiquidityAndObligationCollateralInstruction = (
  liquidityAmount: number | BN,
  sourceLiquidity: PublicKey,
  sourceCollateral: PublicKey,
  reserve: PublicKey,
  reserveLiquiditySupply: PublicKey,
  reserveCollateralMint: PublicKey,
  lendingMarket: PublicKey,
  lendingMarketAuthority: PublicKey,
  destinationCollateral: PublicKey,
  obligation: PublicKey,
  obligationOwner: PublicKey,
  pythOracle: PublicKey,
  switchboardFeedAddress: PublicKey,
  transferAuthority: PublicKey,
  solendProgramAddress: PublicKey,
): TransactionInstruction => {
  const dataLayout = BufferLayout.struct([
    BufferLayout.u8("instruction"),
    Layout.uint64("liquidityAmount"),
  ]);
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction:
        LendingInstruction.DepositReserveLiquidityAndObligationCollateral,
      liquidityAmount: new BN(liquidityAmount),
    },
    data,
  );
  const keys = [
    { pubkey: sourceLiquidity, isSigner: false, isWritable: true },
    { pubkey: sourceCollateral, isSigner: false, isWritable: true },
    { pubkey: reserve, isSigner: false, isWritable: true },
    { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
    { pubkey: reserveCollateralMint, isSigner: false, isWritable: true },
    { pubkey: lendingMarket, isSigner: false, isWritable: true },
    { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
    { pubkey: destinationCollateral, isSigner: false, isWritable: true },
    { pubkey: obligation, isSigner: false, isWritable: true },
    { pubkey: obligationOwner, isSigner: true, isWritable: false },
    { pubkey: pythOracle, isSigner: false, isWritable: false },
    { pubkey: switchboardFeedAddress, isSigner: false, isWritable: false },
    { pubkey: transferAuthority, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    keys,
    programId: solendProgramAddress,
    data,
  });
};

// ─── Borrow Obligation Liquidity ─────────────────────────────────────────────

export const borrowObligationLiquidityInstruction = (
  liquidityAmount: number | BN,
  sourceLiquidity: PublicKey,
  destinationLiquidity: PublicKey,
  borrowReserve: PublicKey,
  borrowReserveLiquidityFeeReceiver: PublicKey,
  obligation: PublicKey,
  lendingMarket: PublicKey,
  lendingMarketAuthority: PublicKey,
  obligationOwner: PublicKey,
  solendProgramAddress: PublicKey,
  depositReserves: Array<PublicKey>,
  hostFeeReceiver?: PublicKey,
): TransactionInstruction => {
  const dataLayout = BufferLayout.struct([
    BufferLayout.u8("instruction"),
    Layout.uint64("liquidityAmount"),
  ]);
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: LendingInstruction.BorrowObligationLiquidity,
      liquidityAmount: new BN(liquidityAmount),
    },
    data,
  );
  const keys = [
    { pubkey: sourceLiquidity, isSigner: false, isWritable: true },
    { pubkey: destinationLiquidity, isSigner: false, isWritable: true },
    { pubkey: borrowReserve, isSigner: false, isWritable: true },
    {
      pubkey: borrowReserveLiquidityFeeReceiver,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: obligation, isSigner: false, isWritable: true },
    { pubkey: lendingMarket, isSigner: false, isWritable: true },
    { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
    { pubkey: obligationOwner, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ...depositReserves.map((reserve) => ({
      pubkey: reserve,
      isSigner: false,
      isWritable: true,
    })),
  ];
  if (hostFeeReceiver) {
    keys.push({ pubkey: hostFeeReceiver, isSigner: false, isWritable: true });
  }
  return new TransactionInstruction({
    keys,
    programId: solendProgramAddress,
    data,
  });
};

// ─── Repay Obligation Liquidity ──────────────────────────────────────────────

export const repayObligationLiquidityInstruction = (
  liquidityAmount: number | BN,
  sourceLiquidity: PublicKey,
  destinationLiquidity: PublicKey,
  repayReserve: PublicKey,
  obligation: PublicKey,
  lendingMarket: PublicKey,
  transferAuthority: PublicKey,
  solendProgramAddress: PublicKey,
): TransactionInstruction => {
  const dataLayout = BufferLayout.struct([
    BufferLayout.u8("instruction"),
    Layout.uint64("liquidityAmount"),
  ]);
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: LendingInstruction.RepayObligationLiquidity,
      liquidityAmount: new BN(liquidityAmount),
    },
    data,
  );
  const keys = [
    { pubkey: sourceLiquidity, isSigner: false, isWritable: true },
    { pubkey: destinationLiquidity, isSigner: false, isWritable: true },
    { pubkey: repayReserve, isSigner: false, isWritable: true },
    { pubkey: obligation, isSigner: false, isWritable: true },
    { pubkey: lendingMarket, isSigner: false, isWritable: false },
    { pubkey: transferAuthority, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    keys,
    programId: solendProgramAddress,
    data,
  });
};

// ─── Withdraw Obligation Collateral And Redeem Reserve Liquidity ─────────────

export const withdrawObligationCollateralAndRedeemReserveLiquidity = (
  collateralAmount: number | BN,
  sourceCollateral: PublicKey,
  destinationCollateral: PublicKey,
  withdrawReserve: PublicKey,
  obligation: PublicKey,
  lendingMarket: PublicKey,
  lendingMarketAuthority: PublicKey,
  destinationLiquidity: PublicKey,
  reserveCollateralMint: PublicKey,
  reserveLiquiditySupply: PublicKey,
  obligationOwner: PublicKey,
  transferAuthority: PublicKey,
  solendProgramAddress: PublicKey,
  depositReserves: Array<PublicKey>,
): TransactionInstruction => {
  const dataLayout = BufferLayout.struct([
    BufferLayout.u8("instruction"),
    Layout.uint64("collateralAmount"),
  ]);
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction:
        LendingInstruction.WithdrawObligationCollateralAndRedeemReserveLiquidity,
      collateralAmount: new BN(collateralAmount),
    },
    data,
  );
  const keys = [
    { pubkey: sourceCollateral, isSigner: false, isWritable: true },
    { pubkey: destinationCollateral, isSigner: false, isWritable: true },
    { pubkey: withdrawReserve, isSigner: false, isWritable: true },
    { pubkey: obligation, isSigner: false, isWritable: true },
    { pubkey: lendingMarket, isSigner: false, isWritable: true },
    { pubkey: lendingMarketAuthority, isSigner: false, isWritable: false },
    { pubkey: destinationLiquidity, isSigner: false, isWritable: true },
    { pubkey: reserveCollateralMint, isSigner: false, isWritable: true },
    { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
    { pubkey: obligationOwner, isSigner: true, isWritable: false },
    { pubkey: transferAuthority, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ...depositReserves.map((reserve) => ({
      pubkey: reserve,
      isSigner: false,
      isWritable: true,
    })),
  ];
  return new TransactionInstruction({
    keys,
    programId: solendProgramAddress,
    data,
  });
};
