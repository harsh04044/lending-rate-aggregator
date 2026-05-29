"use client";

import { getFlashBorrowIx, getFlashPaybackIx } from "@jup-ag/lend/flashloan";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  type AddressLookupTableAccount,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import {
  DEFAULT_RECENT_SLOT_DURATION_MS,
  KaminoAction,
  KaminoMarket,
  VanillaObligation,
  PROGRAM_ID as KAMINO_PROGRAM_ID,
  getUserLutAddressAndSetupIxs,
  type KaminoObligation,
  type ObligationType,
} from "@kamino-finance/klend-sdk";
import {
  address as createAddress,
  createSolanaRpc,
  type TransactionSigner,
} from "@solana/kit";
import { convertToLegacyInstruction } from "@/src/lib/tx/kamino";
import { SAVE_PROGRAM_ID, U64_MAX } from "@/app/lib/solend-sdk/constants";
import {
  borrowObligationLiquidityInstruction,
  depositReserveLiquidityAndObligationCollateralInstruction,
  initObligationInstruction,
  refreshObligationInstruction,
  refreshReserveInstruction,
  repayObligationLiquidityInstruction,
  withdrawObligationCollateralAndRedeemReserveLiquidity,
} from "@/app/lib/solend-sdk/instructions";
import {
  OBLIGATION_SIZE,
  parseObligation,
} from "@/app/lib/solend-sdk/obligation";
import { formatReserve, parseReserve } from "@/app/lib/solend-sdk/reserve";
import { getOperateIx, getVaultsProgram, MIN_I128 } from "@jup-ag/lend/borrow";
// borrowPda is the JupLend `borrow` namespace's PDA-derivation functions.
// Used by fetchJupLendVaultLut to derive a vault's metadata PDA.
import { borrowPda } from "@jup-ag/lend";
import type { SaveReserveDescriptor } from "@/src/lib/tx/save";

const SOL_MINT = "So11111111111111111111111111111111111111112";

const BUFFER_PER_100K = 1;
const BUFFER_FLOOR_RAW = new BN(50);

function applyDebtBuffer(amount: BN): BN {
  const pct = amount.divn(100_000).muln(BUFFER_PER_100K);
  const buffer = BN.max(pct, BUFFER_FLOOR_RAW);
  return amount.add(buffer);
}

// In multi-protocol refinance txs, several SDKs share one WSOL ATA. Each SDK
// (e.g. Kamino's KaminoAction) defensively wraps SOL from the wallet to fund
// the WSOL ATA for its own deposit/repay — correct in isolation, wrong here
// because the prior protocol's close already left the WSOL inside the ATA.
// We own the ATA lifecycle in pre/postIxs, so strip the SDK-injected
// transfer / createATA / syncNative / closeAccount ixs that target it.
function isWsolLifecycleIx(
  ix: TransactionInstruction,
  wsolAta: PublicKey,
): boolean {
  if (ix.programId.equals(SystemProgram.programId)) {
    // Transfer discriminator = 2 (u32 LE), dest at keys[1].
    if (ix.data.length >= 4 && ix.data.readUInt32LE(0) === 2) {
      return ix.keys[1]?.pubkey.equals(wsolAta) ?? false;
    }
    return false;
  }
  if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
    // SyncNative = 17, CloseAccount = 9; target at keys[0].
    const tag = ix.data[0];
    if (tag === 17 || tag === 9) {
      return ix.keys[0]?.pubkey.equals(wsolAta) ?? false;
    }
    return false;
  }
  if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
    // create / createIdempotent: keys[1] = ATA, keys[3] = mint.
    const ata = ix.keys[1]?.pubkey;
    const mint = ix.keys[3]?.pubkey;
    return !!ata && !!mint && ata.equals(wsolAta) && mint.equals(NATIVE_MINT);
  }
  return false;
}

function stripWsolLifecycleIxs(
  ixs: TransactionInstruction[],
  wsolAta: PublicKey,
): TransactionInstruction[] {
  return ixs.filter((ix) => !isWsolLifecycleIx(ix, wsolAta));
}

export interface PrepareJupLendToSaveRefinanceParams {
  jupLendVaultId: number;
  jupLendPositionId: number;
  collateralMint: string;
  debtMint: string;

  savePoolAddress: string;
  saveAuthorityAddress: string;
  saveLookupTableAddress?: string;
  saveCollateralReserve: SaveReserveDescriptor;
  saveDebtReserve?: SaveReserveDescriptor;
  saveAllReserves: SaveReserveDescriptor[];

  collateralAmountRaw: BN;
  debtAmountRaw: BN;
  isMax: boolean;

  walletPublicKey: PublicKey;
  connection: Connection;
}

export interface PreparedRefinance {
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}

// JUPLEND TO SAVE
export async function prepareJupLendToSaveRefinance(
  params: PrepareJupLendToSaveRefinanceParams,
): Promise<PreparedRefinance> {
  const {
    jupLendVaultId,
    jupLendPositionId,
    collateralMint,
    debtMint,
    savePoolAddress,
    saveAuthorityAddress,
    saveLookupTableAddress,
    saveCollateralReserve,
    saveDebtReserve,
    saveAllReserves,
    collateralAmountRaw,
    debtAmountRaw,
    isMax,
    walletPublicKey,
    connection,
  } = params;

  if (jupLendPositionId <= 0) {
    throw new Error("Refinance requires an existing JupLend positionId (>0).");
  }

  if (collateralAmountRaw.lte(new BN(0))) {
    throw new Error("Refinance collateral amount must be positive.");
  }

  const hasDebt = debtAmountRaw.gt(new BN(0));
  if (hasDebt && !saveDebtReserve) {
    throw new Error(
      "saveDebtReserve is required when refinancing a position with debt.",
    );
  }

  // Tiny buffer on debt (covers in-flight interest accrual + MIN_DEBT floor
  // dust). Collateral is passed through as-is — supply interest only grows
  // shares, so displayed amount is safe to redeposit.
  const debtBuffered = applyDebtBuffer(debtAmountRaw);

  // Signed amounts for JupLend's close path. isMax swaps in the i128::MIN
  // sentinel which closes whatever's actually on chain at execution time
  // (handles in-flight interest correctly).
  const colAmountJup = isMax ? MIN_I128 : collateralAmountRaw.neg();
  const debtAmountJup = hasDebt
    ? isMax
      ? MIN_I128
      : debtAmountRaw.neg()
    : new BN(0);

  // ── Save obligation setup ────────────────────────────────────────────
  const saveLendingMarket = new PublicKey(savePoolAddress);
  const saveLendingMarketAuthority = new PublicKey(saveAuthorityAddress);
  const seed = saveLendingMarket.toBase58().slice(0, 32);
  const saveObligationAddress = await PublicKey.createWithSeed(
    walletPublicKey,
    seed,
    SAVE_PROGRAM_ID,
  );

  const saveObligationInfo = await connection.getAccountInfo(
    saveObligationAddress,
  );

  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  // Existing obligation reserves at refresh time — if the user already had
  // a Save obligation, those positions need to stay in the refresh union.
  let existingDepositReserves: PublicKey[] = [];
  let existingBorrowReserves: PublicKey[] = [];

  if (!saveObligationInfo) {
    const lamports =
      await connection.getMinimumBalanceForRentExemption(OBLIGATION_SIZE);
    preIxs.push(
      SystemProgram.createAccountWithSeed({
        fromPubkey: walletPublicKey,
        newAccountPubkey: saveObligationAddress,
        basePubkey: walletPublicKey,
        seed,
        lamports,
        space: OBLIGATION_SIZE,
        programId: SAVE_PROGRAM_ID,
      }),
      initObligationInstruction(
        saveObligationAddress,
        saveLendingMarket,
        walletPublicKey,
        SAVE_PROGRAM_ID,
      ),
    );
  } else {
    const parsed = parseObligation(saveObligationAddress, saveObligationInfo);
    existingDepositReserves =
      parsed?.info.deposits
        .filter((d) => !d.depositedAmount.isZero())
        .map((d) => d.depositReserve) ?? [];
    existingBorrowReserves =
      parsed?.info.borrows
        .filter((b) => !b.borrowedAmountWads.isZero())
        .map((b) => b.borrowReserve) ?? [];
  }

  // ── wSOL setup ───────────────────────────────────────────────────────
  // The flash-borrow lands wSOL into the user's ATA; the JupLend close ix
  // pulls from the same ATA to repay. So we always need the wSOL ATA when
  // either side is SOL. For SOL debt specifically we DON'T pre-fund (the
  // flash loan does that). For SOL collateral we don't pre-fund either —
  // JupLend releases the SOL into the ATA on close.
  const isDebtSol = debtMint === SOL_MINT;
  const isCollateralSol = collateralMint === SOL_MINT;

  if (hasDebt && (isDebtSol || isCollateralSol)) {
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, walletPublicKey);
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        wsolAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
    );
    postIxs.push(
      createCloseAccountInstruction(wsolAta, walletPublicKey, walletPublicKey),
    );
  }

  // ── Flash borrow (executes first; funds the JupLend repay) ───────────
  const flashBorrowIx = hasDebt
    ? await getFlashBorrowIx({
        amount: debtBuffered,
        asset: new PublicKey(debtMint),
        signer: walletPublicKey,
        connection,
      })
    : null;

  // ── JupLend close (uses flashed funds to repay; releases collateral) ─
  const { ixs: closeJupIxs, addressLookupTableAccounts: jupLuts } =
    await getOperateIx({
      vaultId: jupLendVaultId,
      positionId: jupLendPositionId,
      colAmount: colAmountJup,
      debtAmount: debtAmountJup,
      signer: walletPublicKey,
      positionOwner: walletPublicKey,
      connection,
    });

  // ── Save deposit ─────────────────────────────────────────────────────
  const userColLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(saveCollateralReserve.mint),
    walletPublicKey,
  );
  const userColCTokenAta = getAssociatedTokenAddressSync(
    new PublicKey(saveCollateralReserve.collateralMintAddress),
    walletPublicKey,
  );
  preIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      walletPublicKey,
      userColCTokenAta,
      walletPublicKey,
      new PublicKey(saveCollateralReserve.collateralMintAddress),
    ),
  );

  const depositIx = depositReserveLiquidityAndObligationCollateralInstruction(
    collateralAmountRaw,
    userColLiquidityAta,
    userColCTokenAta,
    new PublicKey(saveCollateralReserve.address),
    new PublicKey(saveCollateralReserve.liquidityAddress),
    new PublicKey(saveCollateralReserve.collateralMintAddress),
    saveLendingMarket,
    saveLendingMarketAuthority,
    new PublicKey(saveCollateralReserve.collateralSupplyAddress),
    saveObligationAddress,
    walletPublicKey,
    new PublicKey(saveCollateralReserve.pythOracle),
    new PublicKey(saveCollateralReserve.switchboardOracle),
    walletPublicKey,
    SAVE_PROGRAM_ID,
  );

  // ── Refresh-reserve / refresh-obligation set ─────────────────────────
  const allDepositReserves = dedupePks([
    ...existingDepositReserves,
    new PublicKey(saveCollateralReserve.address),
  ]);
  const allBorrowReserves = dedupePks(existingBorrowReserves);

  const refreshUnion = dedupePks([
    ...allDepositReserves,
    ...allBorrowReserves,
    ...(saveDebtReserve ? [new PublicKey(saveDebtReserve.address)] : []),
    new PublicKey(saveCollateralReserve.address),
  ]);

  const reservesByAddress = new Map(saveAllReserves.map((r) => [r.address, r]));
  const refreshReserveIxs: TransactionInstruction[] = [];
  for (const reserve of refreshUnion) {
    const desc = reservesByAddress.get(reserve.toBase58());
    if (!desc) {
      throw new Error(
        `Save reserve ${reserve.toBase58()} is referenced but not in allReserves.`,
      );
    }
    refreshReserveIxs.push(
      refreshReserveInstruction(
        reserve,
        SAVE_PROGRAM_ID,
        new PublicKey(desc.pythOracle),
        new PublicKey(desc.switchboardOracle),
      ),
    );
  }

  const refreshObligationIx = refreshObligationInstruction(
    saveObligationAddress,
    allDepositReserves,
    allBorrowReserves,
    SAVE_PROGRAM_ID,
  );

  // ── Save borrow + flash payback ──────────────────────────────────────
  let borrowIx: TransactionInstruction | null = null;
  let flashPaybackIx: TransactionInstruction | null = null;

  if (hasDebt && saveDebtReserve) {
    const userDebtLiquidityAta = getAssociatedTokenAddressSync(
      new PublicKey(saveDebtReserve.mint),
      walletPublicKey,
    );

    // For non-SOL debt the user needs an ATA to receive the borrowed
    // tokens. For SOL debt the wsolAta is already created in preIxs above.
    if (!isDebtSol) {
      preIxs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          walletPublicKey,
          userDebtLiquidityAta,
          walletPublicKey,
          new PublicKey(saveDebtReserve.mint),
        ),
      );
    }

    borrowIx = borrowObligationLiquidityInstruction(
      debtBuffered,
      new PublicKey(saveDebtReserve.liquidityAddress),
      userDebtLiquidityAta,
      new PublicKey(saveDebtReserve.address),
      new PublicKey(saveDebtReserve.liquidityFeeReceiverAddress),
      saveObligationAddress,
      saveLendingMarket,
      saveLendingMarketAuthority,
      walletPublicKey,
      SAVE_PROGRAM_ID,
      allDepositReserves,
    );

    flashPaybackIx = await getFlashPaybackIx({
      amount: debtBuffered,
      asset: new PublicKey(debtMint),
      signer: walletPublicKey,
      connection,
    });
  }

  // ── Stitch the tx together (in execution order) ─────────────────────
  const allInstructions: TransactionInstruction[] = [
    ...preIxs,
    ...(flashBorrowIx ? [flashBorrowIx] : []),
    ...closeJupIxs,
    depositIx,
    ...refreshReserveIxs,
    refreshObligationIx,
    ...(borrowIx ? [borrowIx] : []),
    ...(flashPaybackIx ? [flashPaybackIx] : []),
    ...postIxs,
  ];

  // ── Lookup tables ────────────────────────────────────────────────────
  const saveLuts: AddressLookupTableAccount[] = [];
  if (saveLookupTableAddress) {
    try {
      const lutInfo = await connection.getAddressLookupTable(
        new PublicKey(saveLookupTableAddress),
      );
      if (lutInfo.value) saveLuts.push(lutInfo.value);
    } catch (e) {
      console.warn("Failed to fetch Save pool LUT:", e);
    }
  }

  return {
    instructions: allInstructions,
    lookupTables: mergeLookupTables([...(jupLuts ?? []), ...saveLuts]),
  };
}

// SAVE TO JUPLEND
export interface PrepareSaveToJupLendRefinanceParams {
  jupLendVaultId: number;
  jupLendPositionId: number;
  collateralMint: string;
  debtMint: string;
  savePoolAddress: string;
  saveAuthorityAddress: string;
  saveLookupTableAddress?: string;
  saveCollateralReserve: SaveReserveDescriptor;
  saveDebtReserve: SaveReserveDescriptor;
  saveAllReserves: SaveReserveDescriptor[];
  collateralAmountRaw: BN;
  debtAmountRaw: BN;
  isMax: boolean;
  isDebtMax: boolean;
  walletPublicKey: PublicKey;
  connection: Connection;
}

export async function prepareSaveToJupLendRefinance(
  params: PrepareSaveToJupLendRefinanceParams,
): Promise<PreparedRefinance> {
  const {
    jupLendVaultId,
    jupLendPositionId,
    collateralMint,
    debtMint,
    savePoolAddress,
    saveAuthorityAddress,
    saveLookupTableAddress,
    saveCollateralReserve,
    saveDebtReserve,
    saveAllReserves,
    collateralAmountRaw,
    debtAmountRaw,
    isMax,
    isDebtMax,
    walletPublicKey,
    connection,
  } = params;

  if (collateralAmountRaw.lte(new BN(0))) {
    throw new Error("Refinance collateral amount must be positive.");
  }
  if (debtAmountRaw.lte(new BN(0))) {
    throw new Error(
      "Save to JupLend refinance requires a non-zero debt amount.",
    );
  }

  // Tiny debt buffer (covers in-flight interest accrual). Collateral passed
  // through as-is.
  const debtBuffered = applyDebtBuffer(debtAmountRaw);

  // ── Save obligation ──────────────────────────────────────────────────
  const saveLendingMarket = new PublicKey(savePoolAddress);
  const saveLendingMarketAuthority = new PublicKey(saveAuthorityAddress);
  const seed = saveLendingMarket.toBase58().slice(0, 32);
  const saveObligationAddress = await PublicKey.createWithSeed(
    walletPublicKey,
    seed,
    SAVE_PROGRAM_ID,
  );

  const saveObligationInfo = await connection.getAccountInfo(
    saveObligationAddress,
  );
  if (!saveObligationInfo) {
    throw new Error(
      "Save obligation account not found — nothing to refinance from Save.",
    );
  }
  const parsed = parseObligation(saveObligationAddress, saveObligationInfo);
  if (!parsed) throw new Error("Failed to parse Save obligation.");

  const existingDepositReserves = parsed.info.deposits
    .filter((d) => !d.depositedAmount.isZero())
    .map((d) => d.depositReserve);
  const existingBorrowReserves = parsed.info.borrows
    .filter((b) => !b.borrowedAmountWads.isZero())
    .map((b) => b.borrowReserve);

  let withdrawAmount: BN;
  if (isMax) {
    withdrawAmount = new BN(U64_MAX);
  } else {
    // cToken amount to withdraw = liquidity amount / exchange rate.
    const reserveInfo = await connection.getAccountInfo(
      new PublicKey(saveCollateralReserve.address),
    );
    if (!reserveInfo) {
      throw new Error("Failed to load Save reserve for withdraw conversion.");
    }
    const parsedReserve = parseReserve(
      new PublicKey(saveCollateralReserve.address),
      reserveInfo,
    );
    if (!parsedReserve) {
      throw new Error("Failed to parse Save reserve for withdraw conversion.");
    }
    const formatted = formatReserve(parsedReserve);
    const rate = formatted.cTokenExchangeRate.toNumber();
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Save cToken exchange rate is invalid.");
    }

    const liquidityNum = Number(collateralAmountRaw.toString());
    const cTokenNum = Math.ceil(liquidityNum / rate);
    withdrawAmount = new BN(cTokenNum.toString());
  }

  const isDebtSol = debtMint === SOL_MINT;
  const isCollateralSol = collateralMint === SOL_MINT;

  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  // wSOL setup
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, walletPublicKey);
  if (isDebtSol || isCollateralSol) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        wsolAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
    );
    postIxs.push(
      createCloseAccountInstruction(wsolAta, walletPublicKey, walletPublicKey),
    );
  }

  // Debt ATA
  const userDebtLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(debtMint),
    walletPublicKey,
  );
  if (!isDebtSol) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        userDebtLiquidityAta,
        walletPublicKey,
        new PublicKey(debtMint),
      ),
    );
  }

  // Collateral ATAs
  const userColLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(saveCollateralReserve.mint),
    walletPublicKey,
  );
  const userColCTokenAta = getAssociatedTokenAddressSync(
    new PublicKey(saveCollateralReserve.collateralMintAddress),
    walletPublicKey,
  );
  preIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      walletPublicKey,
      userColCTokenAta,
      walletPublicKey,
      new PublicKey(saveCollateralReserve.collateralMintAddress),
    ),
  );
  if (!isCollateralSol) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        userColLiquidityAta,
        walletPublicKey,
        new PublicKey(saveCollateralReserve.mint),
      ),
    );
  }

  // Flash borrow
  const flashBorrowIx = await getFlashBorrowIx({
    amount: debtBuffered,
    asset: new PublicKey(debtMint),
    signer: walletPublicKey,
    connection,
  });

  // Save repay
  const repayIx = repayObligationLiquidityInstruction(
    isMax ? new BN(U64_MAX) : debtBuffered,
    userDebtLiquidityAta,
    new PublicKey(saveDebtReserve.liquidityAddress),
    new PublicKey(saveDebtReserve.address),
    saveObligationAddress,
    saveLendingMarket,
    walletPublicKey,
    SAVE_PROGRAM_ID,
  );

  // Refresh union
  const refreshUnion = dedupePks([
    ...existingDepositReserves,
    ...existingBorrowReserves,
    new PublicKey(saveCollateralReserve.address),
    new PublicKey(saveDebtReserve.address),
  ]);

  const reservesByAddress = new Map(saveAllReserves.map((r) => [r.address, r]));
  const refreshReserveIxs: TransactionInstruction[] = [];
  for (const reserve of refreshUnion) {
    const desc = reservesByAddress.get(reserve.toBase58());
    if (!desc) {
      throw new Error(
        `Save reserve ${reserve.toBase58()} is referenced but not in allReserves.`,
      );
    }
    refreshReserveIxs.push(
      refreshReserveInstruction(
        reserve,
        SAVE_PROGRAM_ID,
        new PublicKey(desc.pythOracle),
        new PublicKey(desc.switchboardOracle),
      ),
    );
  }

  const refreshBorrowReserves = isDebtMax
    ? existingBorrowReserves.filter(
        (r) => r.toBase58() !== saveDebtReserve.address,
      )
    : existingBorrowReserves;
  const refreshDepositReserves = existingDepositReserves;

  const refreshObligationIx = refreshObligationInstruction(
    saveObligationAddress,
    refreshDepositReserves,
    refreshBorrowReserves,
    SAVE_PROGRAM_ID,
  );

  // Save withdraw
  const withdrawIx = withdrawObligationCollateralAndRedeemReserveLiquidity(
    withdrawAmount,
    new PublicKey(saveCollateralReserve.collateralSupplyAddress),
    userColCTokenAta,
    new PublicKey(saveCollateralReserve.address),
    saveObligationAddress,
    saveLendingMarket,
    saveLendingMarketAuthority,
    userColLiquidityAta,
    new PublicKey(saveCollateralReserve.collateralMintAddress),
    new PublicKey(saveCollateralReserve.liquidityAddress),
    walletPublicKey,
    walletPublicKey,
    SAVE_PROGRAM_ID,
    refreshDepositReserves,
  );

  withdrawIx.keys.push(
    {
      pubkey: new PublicKey(saveCollateralReserve.pythOracle),
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: new PublicKey(saveCollateralReserve.switchboardOracle),
      isSigner: false,
      isWritable: false,
    },
  );

  // Jup amounts, mate.
  const colAmountJup = collateralAmountRaw; // positive = deposit
  const debtAmountJup = debtBuffered; // positive = borrow

  const { ixs: openJupIxs, addressLookupTableAccounts: jupLuts } =
    await getOperateIx({
      vaultId: jupLendVaultId,
      positionId: jupLendPositionId,
      colAmount: colAmountJup,
      debtAmount: debtAmountJup,
      signer: walletPublicKey,
      positionOwner: walletPublicKey,
      connection,
    });

  // Flash payback
  const flashPaybackIx = await getFlashPaybackIx({
    amount: debtBuffered,
    asset: new PublicKey(debtMint),
    signer: walletPublicKey,
    connection,
  });

  // Stitch (in execution order)
  const allInstructions: TransactionInstruction[] = [
    ...preIxs,
    flashBorrowIx,
    repayIx,
    ...refreshReserveIxs,
    refreshObligationIx,
    withdrawIx,
    ...openJupIxs,
    flashPaybackIx,
    ...postIxs,
  ];

  // Lookup tables
  const saveLuts: AddressLookupTableAccount[] = [];
  if (saveLookupTableAddress) {
    try {
      const lutInfo = await connection.getAddressLookupTable(
        new PublicKey(saveLookupTableAddress),
      );
      if (lutInfo.value) saveLuts.push(lutInfo.value);
    } catch (e) {
      console.warn("Failed to fetch Save pool LUT:", e);
    }
  }

  return {
    instructions: allInstructions,
    lookupTables: mergeLookupTables([...(jupLuts ?? []), ...saveLuts]),
  };
}

// JUPLEND TO KAMINO
export interface PrepareJupLendToKaminoRefinanceParams {
  jupLendVaultId: number;
  jupLendPositionId: number;
  collateralMint: string;
  debtMint: string;

  kaminoMarketAddress: string;

  collateralAmountRaw: BN;
  debtAmountRaw: BN;
  isMax: boolean;

  walletPublicKey: PublicKey;
  connection: Connection;
}

export async function prepareJupLendToKaminoRefinance(
  params: PrepareJupLendToKaminoRefinanceParams,
): Promise<PreparedRefinance> {
  const {
    jupLendVaultId,
    jupLendPositionId,
    collateralMint,
    debtMint,
    kaminoMarketAddress,
    collateralAmountRaw,
    debtAmountRaw,
    isMax,
    walletPublicKey,
    connection,
  } = params;

  if (jupLendPositionId <= 0) {
    throw new Error("Refinance requires an existing JupLend positionId (>0).");
  }
  if (collateralAmountRaw.lte(new BN(0))) {
    throw new Error("Refinance collateral amount must be positive.");
  }

  const hasDebt = debtAmountRaw.gt(new BN(0));
  const debtBuffered = hasDebt ? applyDebtBuffer(debtAmountRaw) : new BN(0);

  const colAmountJup = isMax ? MIN_I128 : collateralAmountRaw.neg();
  const debtAmountJup = hasDebt
    ? isMax
      ? MIN_I128
      : debtAmountRaw.neg()
    : new BN(0);

  const isDebtSol = debtMint === SOL_MINT;
  const isCollateralSol = collateralMint === SOL_MINT;

  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, walletPublicKey);
  if (hasDebt && (isDebtSol || isCollateralSol)) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        wsolAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
    );
    postIxs.push(
      createCloseAccountInstruction(wsolAta, walletPublicKey, walletPublicKey),
    );
  }

  const flashBorrowIx = hasDebt
    ? await getFlashBorrowIx({
        amount: debtBuffered,
        asset: new PublicKey(debtMint),
        signer: walletPublicKey,
        connection,
      })
    : null;

  // JupLend close (uses flashed funds to repay, releases collateral)
  const { ixs: closeJupIxs, addressLookupTableAccounts: jupLuts } =
    await getOperateIx({
      vaultId: jupLendVaultId,
      positionId: jupLendPositionId,
      colAmount: colAmountJup,
      debtAmount: debtAmountJup,
      signer: walletPublicKey,
      positionOwner: walletPublicKey,
      connection,
    });

  // Load Kamino market + obligation
  const rpc = createSolanaRpc(connection.rpcEndpoint);
  const market = await KaminoMarket.load(
    rpc,
    createAddress(kaminoMarketAddress),
    DEFAULT_RECENT_SLOT_DURATION_MS,
  );
  if (!market) throw new Error("Failed to load Kamino market");
  await market.loadReserves();

  const owner = {
    address: createAddress(walletPublicKey.toBase58()),
  } as TransactionSigner;

  let obligation: KaminoObligation | ObligationType;
  let hasExistingObligation = false;
  try {
    obligation = await market.getUserVanillaObligation(
      createAddress(walletPublicKey.toBase58()),
    );
    hasExistingObligation = !!obligation;
  } catch {
    obligation = new VanillaObligation(createAddress(KAMINO_PROGRAM_ID));
  }

  const depositMint = createAddress(collateralMint);
  const borrowMint = createAddress(debtMint);

  // Kamino deposit (+ borrow)
  const kaminoIxs: TransactionInstruction[] = [];

  if (hasDebt) {
    const action = await KaminoAction.buildDepositAndBorrowTxns(
      market,
      collateralAmountRaw,
      depositMint,
      debtBuffered,
      borrowMint,
      owner,
      obligation,
      true, // useV2Ixs
      undefined, // scopeRefreshConfig
      0, // extraComputeBudget
      true, // includeAtaIxs (idempotent ATAs are safe)
      false, // requestElevationGroup
      { skipInitialization: hasExistingObligation, skipLutCreation: true },
    );

    // setup/inBetween scrubbed of WSOL-lifecycle ixs — Kamino's SDK assumes
    // it owns the WSOL ATA and would double-fund it (the prior JupLend close
    // already left WSOL inside). cleanupIxs intentionally skipped — closing
    // wSOL there would strand the flash payback.
    const setupClean = stripWsolLifecycleIxs(
      action.setupIxs.map(convertToLegacyInstruction),
      wsolAta,
    );
    const inBetweenClean = stripWsolLifecycleIxs(
      action.inBetweenIxs.map(convertToLegacyInstruction),
      wsolAta,
    );
    kaminoIxs.push(
      ...setupClean,
      convertToLegacyInstruction(action.lendingIxs[0]),
      ...inBetweenClean,
      convertToLegacyInstruction(action.lendingIxs[1]),
    );
  } else {
    const action = await KaminoAction.buildDepositTxns(
      market,
      collateralAmountRaw,
      depositMint,
      owner,
      obligation,
      true,
      undefined,
      0,
      true,
      false,
      { skipInitialization: hasExistingObligation, skipLutCreation: true },
    );

    kaminoIxs.push(
      ...action.setupIxs.map(convertToLegacyInstruction),
      ...action.lendingIxs.map(convertToLegacyInstruction),
      ...action.cleanupIxs.map(convertToLegacyInstruction),
    );
  }

  const flashPaybackIx = hasDebt
    ? await getFlashPaybackIx({
        amount: debtBuffered,
        asset: new PublicKey(debtMint),
        signer: walletPublicKey,
        connection,
      })
    : null;

  const allInstructions: TransactionInstruction[] = [
    ...preIxs,
    ...(flashBorrowIx ? [flashBorrowIx] : []),
    ...closeJupIxs,
    ...kaminoIxs,
    ...(flashPaybackIx ? [flashPaybackIx] : []),
    ...postIxs,
  ];

  const kaminoLuts = await fetchKaminoLookupTables(
    connection,
    kaminoMarketAddress,
    market,
    owner,
    collateralMint,
    debtMint,
  );

  return {
    instructions: allInstructions,
    lookupTables: mergeLookupTables([...(jupLuts ?? []), ...kaminoLuts]),
  };
}

const KAMINO_MARKET_LUTS: Record<string, string> = {
  // Main market
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF":
    "284iwGtA9X9aLy3KsyV8uT2pXLARhYbiSi5SiM2g47M2",
  // JLP market
  DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek:
    "GprZNyWk67655JhX6Rq9KoebQ6WkQYRhATWzkx2P2LNc",
};

async function fetchKaminoLookupTables(
  connection: Connection,
  marketAddress: string,
  market: KaminoMarket,
  owner: TransactionSigner,
  collateralMint: string,
  debtMint: string,
): Promise<AddressLookupTableAccount[]> {
  const luts: AddressLookupTableAccount[] = [];
  const seen = new Set<string>();

  const push = async (pk: PublicKey) => {
    const key = pk.toBase58();
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const { value } = await connection.getAddressLookupTable(pk);
      if (value) luts.push(value);
    } catch (e) {
      console.warn(`[fetchKaminoLookupTables] LUT ${key} fetch failed:`, e);
    }
  };

  const marketLut = KAMINO_MARKET_LUTS[marketAddress];
  if (marketLut) await push(new PublicKey(marketLut));

  try {
    const res = await fetch("https://cdn.kamino.finance/resources.json");
    if (res.ok) {
      const data = (await res.json()) as {
        "mainnet-beta"?: {
          multiplyLUTs?: Record<string, string[]>;
          multiplyLUTsPairs?: Record<string, Record<string, string[]>>;
          repayWithCollLUTs?: Record<string, string>;
        };
      };
      const mb = data["mainnet-beta"];

      const colLuts = mb?.multiplyLUTs?.[collateralMint] ?? [];
      for (const lut of colLuts) await push(new PublicKey(lut));

      const pairLuts =
        mb?.multiplyLUTsPairs?.[collateralMint]?.[debtMint] ?? [];
      for (const lut of pairLuts) await push(new PublicKey(lut));

      const repayLut = mb?.repayWithCollLUTs?.[`${collateralMint}-${debtMint}`];
      if (repayLut) await push(new PublicKey(repayLut));
    }
  } catch (e) {
    console.warn("[fetchKaminoLookupTables] CDN fetch failed:", e);
  }

  // User LUT, only useful if the wallet already has Kamino UserMetadata.
  // For first-time Kamino users the address still derives but there's no
  // account behind it, the fetch returns null and we skip gracefully.
  try {
    const [userLutAddress] = await getUserLutAddressAndSetupIxs(
      market,
      owner,
      undefined,
      false,
      [{ coll: createAddress(collateralMint), debt: createAddress(debtMint) }],
      [],
    );
    await push(new PublicKey(userLutAddress));
  } catch (e) {
    console.warn("[fetchKaminoLookupTables] user LUT lookup failed:", e);
  }

  return luts;
}

// KAMINO TO JUPLEND
export interface PrepareKaminoToJupLendRefinanceParams {
  jupLendVaultId: number;
  jupLendPositionId: number;
  collateralMint: string;
  debtMint: string;

  kaminoMarketAddress: string;

  collateralAmountRaw: BN;
  debtAmountRaw: BN;
  isMax: boolean;

  walletPublicKey: PublicKey;
  connection: Connection;
}

export async function prepareKaminoToJupLendRefinance(
  params: PrepareKaminoToJupLendRefinanceParams,
): Promise<PreparedRefinance> {
  const {
    jupLendVaultId,
    jupLendPositionId,
    collateralMint,
    debtMint,
    kaminoMarketAddress,
    collateralAmountRaw,
    debtAmountRaw,
    isMax,
    walletPublicKey,
    connection,
  } = params;

  if (collateralAmountRaw.lte(new BN(0))) {
    throw new Error("Refinance collateral amount must be positive.");
  }
  if (debtAmountRaw.lte(new BN(0))) {
    throw new Error(
      "Kamino to JupLend refinance requires a non-zero debt amount.",
    );
  }

  const debtBuffered = applyDebtBuffer(debtAmountRaw);

  const isDebtSol = debtMint === SOL_MINT;
  const isCollateralSol = collateralMint === SOL_MINT;

  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  // wSOL ATA, flash borrow lands here, Kamino withdraw releases SOL
  // collateral here (since includeAtaIxs is true), and JupLend open pulls
  // collateral from here.
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, walletPublicKey);
  if (isDebtSol || isCollateralSol) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        wsolAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
    );
    postIxs.push(
      createCloseAccountInstruction(wsolAta, walletPublicKey, walletPublicKey),
    );
  }

  // Load Kamino market + obligation (must already exist, we're refinancing
  // out of an existing position).
  const rpc = createSolanaRpc(connection.rpcEndpoint);
  const market = await KaminoMarket.load(
    rpc,
    createAddress(kaminoMarketAddress),
    DEFAULT_RECENT_SLOT_DURATION_MS,
  );
  if (!market) throw new Error("Failed to load Kamino market");
  await market.loadReserves();

  const owner = {
    address: createAddress(walletPublicKey.toBase58()),
  } as TransactionSigner;

  const obligation = await market.getUserVanillaObligation(
    createAddress(walletPublicKey.toBase58()),
  );
  if (!obligation) {
    throw new Error(
      "No existing Kamino obligation for this wallet on this market.",
    );
  }

  // Flash borrow funds the Kamino repay.
  const flashBorrowIx = await getFlashBorrowIx({
    amount: debtBuffered,
    asset: new PublicKey(debtMint),
    signer: walletPublicKey,
    connection,
  });

  // Kamino's RepayAndWithdraw needs the current slot for fresh oracle
  // validation.
  const currentSlot = await rpc.getSlot().send();

  const repayAmount = isMax ? U64_MAX : debtBuffered;
  const withdrawAmount = isMax ? U64_MAX : collateralAmountRaw;

  const action = await KaminoAction.buildRepayAndWithdrawTxns(
    market,
    repayAmount,
    createAddress(debtMint),
    withdrawAmount,
    createAddress(collateralMint),
    owner,
    currentSlot,
    obligation,
    true, // useV2Ixs
    undefined, // scopeRefreshConfig
    0, // extraComputeBudget
    true, // includeAtaIxs — Kamino creates ATAs idempotently
    false, // requestElevationGroup
    { skipInitialization: true, skipLutCreation: true },
  );

  // setup/inBetween scrubbed of WSOL-lifecycle ixs — Kamino's SDK would
  // otherwise wrap repay-amount SOL from the wallet, but we fund the WSOL
  // ATA via flash borrow. cleanupIxs intentionally skipped.
  const setupClean = stripWsolLifecycleIxs(
    action.setupIxs.map(convertToLegacyInstruction),
    wsolAta,
  );
  const inBetweenClean = stripWsolLifecycleIxs(
    action.inBetweenIxs.map(convertToLegacyInstruction),
    wsolAta,
  );
  const kaminoIxs: TransactionInstruction[] = [
    ...setupClean,
    convertToLegacyInstruction(action.lendingIxs[0]), // repay
    ...inBetweenClean,
    convertToLegacyInstruction(action.lendingIxs[1]), // withdraw
  ];

  const colAmountJup = collateralAmountRaw;
  const debtAmountJup = debtBuffered;

  const { ixs: openJupIxs, addressLookupTableAccounts: jupLuts } =
    await getOperateIx({
      vaultId: jupLendVaultId,
      positionId: jupLendPositionId,
      colAmount: colAmountJup,
      debtAmount: debtAmountJup,
      signer: walletPublicKey,
      positionOwner: walletPublicKey,
      connection,
    });

  const flashPaybackIx = await getFlashPaybackIx({
    amount: debtBuffered,
    asset: new PublicKey(debtMint),
    signer: walletPublicKey,
    connection,
  });

  const allInstructions: TransactionInstruction[] = [
    ...preIxs,
    flashBorrowIx,
    ...kaminoIxs,
    ...openJupIxs,
    flashPaybackIx,
    ...postIxs,
  ];

  const kaminoLuts = await fetchKaminoLookupTables(
    connection,
    kaminoMarketAddress,
    market,
    owner,
    collateralMint,
    debtMint,
  );

  return {
    instructions: allInstructions,
    lookupTables: mergeLookupTables([...(jupLuts ?? []), ...kaminoLuts]),
  };
}

// Fetches a JupLend vault's LUT by reading its on-chain `vaultMetadata` and
// then loading the address lookup table account. The flash-borrow /
// flash-payback ixs we use don't return LUTs themselves, but a JupLend
// vault that uses the same debt asset (e.g. SOL/USDC vault when our flash
// loan borrows USDC) has an LUT covering USDC's rate model, liquidity
// reserve, and other shared accounts the flash ixs reference. Adding it
// shrinks the v0 message materially.
async function fetchJupLendVaultLut(
  connection: Connection,
  vaultId: number,
  signer: PublicKey,
): Promise<AddressLookupTableAccount | null> {
  try {
    const program = getVaultsProgram({ connection, signer });
    const metadata = await program.account.vaultMetadata.fetch(
      borrowPda.getVaultMetadata(vaultId),
    );
    const lutAddr = metadata.lookupTable as PublicKey;
    const lutAccount = await connection.getAddressLookupTable(lutAddr);
    return lutAccount.value ?? null;
  } catch (e) {
    console.warn("[fetchJupLendVaultLut] failed:", e);
    return null;
  }
}

// KAMINO TO SAVE
export interface PrepareKaminoToSaveRefinanceParams {
  kaminoMarketAddress: string;
  collateralMint: string;
  debtMint: string;

  savePoolAddress: string;
  saveAuthorityAddress: string;
  saveLookupTableAddress?: string;
  saveCollateralReserve: SaveReserveDescriptor;
  saveDebtReserve: SaveReserveDescriptor;
  saveAllReserves: SaveReserveDescriptor[];

  auxJupLendVaultId?: number;

  collateralAmountRaw: BN;
  debtAmountRaw: BN;
  isMax: boolean;

  walletPublicKey: PublicKey;
  connection: Connection;
}

export async function prepareKaminoToSaveRefinance(
  params: PrepareKaminoToSaveRefinanceParams,
): Promise<PreparedRefinance> {
  const {
    kaminoMarketAddress,
    collateralMint,
    debtMint,
    savePoolAddress,
    saveAuthorityAddress,
    saveLookupTableAddress,
    saveCollateralReserve,
    saveDebtReserve,
    saveAllReserves,
    auxJupLendVaultId,
    collateralAmountRaw,
    debtAmountRaw,
    isMax,
    walletPublicKey,
    connection,
  } = params;

  if (collateralAmountRaw.lte(new BN(0))) {
    throw new Error("Refinance collateral amount must be positive.");
  }
  if (debtAmountRaw.lte(new BN(0))) {
    throw new Error(
      "Kamino to Save refinance requires a non-zero debt amount.",
    );
  }

  const debtBuffered = applyDebtBuffer(debtAmountRaw);

  const isDebtSol = debtMint === SOL_MINT;
  const isCollateralSol = collateralMint === SOL_MINT;

  // ── Save obligation setup ────────────────────────────────────────────
  const saveLendingMarket = new PublicKey(savePoolAddress);
  const saveLendingMarketAuthority = new PublicKey(saveAuthorityAddress);
  const seed = saveLendingMarket.toBase58().slice(0, 32);
  const saveObligationAddress = await PublicKey.createWithSeed(
    walletPublicKey,
    seed,
    SAVE_PROGRAM_ID,
  );

  const saveObligationInfo = await connection.getAccountInfo(
    saveObligationAddress,
  );

  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  let existingDepositReserves: PublicKey[] = [];
  let existingBorrowReserves: PublicKey[] = [];

  if (!saveObligationInfo) {
    const lamports =
      await connection.getMinimumBalanceForRentExemption(OBLIGATION_SIZE);
    preIxs.push(
      SystemProgram.createAccountWithSeed({
        fromPubkey: walletPublicKey,
        newAccountPubkey: saveObligationAddress,
        basePubkey: walletPublicKey,
        seed,
        lamports,
        space: OBLIGATION_SIZE,
        programId: SAVE_PROGRAM_ID,
      }),
      initObligationInstruction(
        saveObligationAddress,
        saveLendingMarket,
        walletPublicKey,
        SAVE_PROGRAM_ID,
      ),
    );
  } else {
    const parsed = parseObligation(saveObligationAddress, saveObligationInfo);
    existingDepositReserves =
      parsed?.info.deposits
        .filter((d) => !d.depositedAmount.isZero())
        .map((d) => d.depositReserve) ?? [];
    existingBorrowReserves =
      parsed?.info.borrows
        .filter((b) => !b.borrowedAmountWads.isZero())
        .map((b) => b.borrowReserve) ?? [];
  }

  if (isDebtSol || isCollateralSol) {
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, walletPublicKey);
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        wsolAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
    );
  }

  // Save collateral cToken ATA (always needed)
  const userColLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(saveCollateralReserve.mint),
    walletPublicKey,
  );
  const userColCTokenAta = getAssociatedTokenAddressSync(
    new PublicKey(saveCollateralReserve.collateralMintAddress),
    walletPublicKey,
  );
  preIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      walletPublicKey,
      userColCTokenAta,
      walletPublicKey,
      new PublicKey(saveCollateralReserve.collateralMintAddress),
    ),
  );

  const userDebtLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(saveDebtReserve.mint),
    walletPublicKey,
  );
  if (!isDebtSol) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        userDebtLiquidityAta,
        walletPublicKey,
        new PublicKey(saveDebtReserve.mint),
      ),
    );
  }

  // ── Flash borrow (executes first; funds the Kamino repay) ────────────
  const flashBorrowIx = await getFlashBorrowIx({
    amount: debtBuffered,
    asset: new PublicKey(debtMint),
    signer: walletPublicKey,
    connection,
  });

  // ── Kamino repay + withdraw ──────────────────────────────────────────
  const rpc = createSolanaRpc(connection.rpcEndpoint);
  const kaminoMarket = await KaminoMarket.load(
    rpc,
    createAddress(kaminoMarketAddress),
    DEFAULT_RECENT_SLOT_DURATION_MS,
  );
  if (!kaminoMarket) throw new Error("Failed to load Kamino market");
  await kaminoMarket.loadReserves();

  const kaminoOwner = {
    address: createAddress(walletPublicKey.toBase58()),
  } as TransactionSigner;

  const kaminoObligation = await kaminoMarket.getUserVanillaObligation(
    createAddress(walletPublicKey.toBase58()),
  );
  if (!kaminoObligation) {
    throw new Error(
      "No existing Kamino obligation for this wallet on this market.",
    );
  }

  const currentSlot = await rpc.getSlot().send();

  const repayAmount = isMax ? U64_MAX : debtBuffered;
  const withdrawAmount = isMax ? U64_MAX : collateralAmountRaw;

  const kaminoAction = await KaminoAction.buildRepayAndWithdrawTxns(
    kaminoMarket,
    repayAmount,
    createAddress(debtMint),
    withdrawAmount,
    createAddress(collateralMint),
    kaminoOwner,
    currentSlot,
    kaminoObligation,
    true, // useV2Ixs
    undefined, // scopeRefreshConfig
    0, // extraComputeBudget
    false,
    false, // requestElevationGroup
    { skipInitialization: true, skipLutCreation: true },
  );

  const kaminoIxs: TransactionInstruction[] = [
    ...kaminoAction.setupIxs
      .map(convertToLegacyInstruction)
      .filter((ix) => ix.programId.toBase58() === KAMINO_PROGRAM_ID),
    convertToLegacyInstruction(kaminoAction.lendingIxs[0]), // repay
    ...kaminoAction.inBetweenIxs
      .map(convertToLegacyInstruction)
      .filter((ix) => ix.programId.toBase58() === KAMINO_PROGRAM_ID),
    convertToLegacyInstruction(kaminoAction.lendingIxs[1]), // withdraw
  ];

  // ── Save deposit ─────────────────────────────────────────────────────
  const depositIx = depositReserveLiquidityAndObligationCollateralInstruction(
    collateralAmountRaw,
    userColLiquidityAta,
    userColCTokenAta,
    new PublicKey(saveCollateralReserve.address),
    new PublicKey(saveCollateralReserve.liquidityAddress),
    new PublicKey(saveCollateralReserve.collateralMintAddress),
    saveLendingMarket,
    saveLendingMarketAuthority,
    new PublicKey(saveCollateralReserve.collateralSupplyAddress),
    saveObligationAddress,
    walletPublicKey,
    new PublicKey(saveCollateralReserve.pythOracle),
    new PublicKey(saveCollateralReserve.switchboardOracle),
    walletPublicKey,
    SAVE_PROGRAM_ID,
  );

  const allDepositReserves = dedupePks([
    ...existingDepositReserves,
    new PublicKey(saveCollateralReserve.address),
  ]);
  const allBorrowReserves = dedupePks(existingBorrowReserves);

  const refreshUnion = dedupePks([
    ...allDepositReserves,
    ...allBorrowReserves,
    new PublicKey(saveDebtReserve.address),
  ]);

  const reservesByAddress = new Map(saveAllReserves.map((r) => [r.address, r]));
  const refreshReserveIxs: TransactionInstruction[] = [];
  for (const reserve of refreshUnion) {
    const desc = reservesByAddress.get(reserve.toBase58());
    if (!desc) {
      throw new Error(
        `Save reserve ${reserve.toBase58()} is referenced but not in allReserves.`,
      );
    }
    refreshReserveIxs.push(
      refreshReserveInstruction(
        reserve,
        SAVE_PROGRAM_ID,
        new PublicKey(desc.pythOracle),
        new PublicKey(desc.switchboardOracle),
      ),
    );
  }

  const refreshObligationIx = refreshObligationInstruction(
    saveObligationAddress,
    allDepositReserves,
    allBorrowReserves,
    SAVE_PROGRAM_ID,
  );

  // ── Save borrow + flash payback ──────────────────────────────────────
  const borrowIx = borrowObligationLiquidityInstruction(
    debtBuffered,
    new PublicKey(saveDebtReserve.liquidityAddress),
    userDebtLiquidityAta,
    new PublicKey(saveDebtReserve.address),
    new PublicKey(saveDebtReserve.liquidityFeeReceiverAddress),
    saveObligationAddress,
    saveLendingMarket,
    saveLendingMarketAuthority,
    walletPublicKey,
    SAVE_PROGRAM_ID,
    allDepositReserves,
  );

  const flashPaybackIx = await getFlashPaybackIx({
    amount: debtBuffered,
    asset: new PublicKey(debtMint),
    signer: walletPublicKey,
    connection,
  });

  // ── Stitch ───────────────────────────────────────────────────────────
  const allInstructions: TransactionInstruction[] = [
    ...preIxs,
    flashBorrowIx,
    ...kaminoIxs,
    depositIx,
    ...refreshReserveIxs,
    refreshObligationIx,
    borrowIx,
    flashPaybackIx,
    ...postIxs,
  ];

  // ── Lookup tables ────────────────────────────────────────────────────
  const saveLuts: AddressLookupTableAccount[] = [];
  if (saveLookupTableAddress) {
    try {
      const lutInfo = await connection.getAddressLookupTable(
        new PublicKey(saveLookupTableAddress),
      );
      if (lutInfo.value) saveLuts.push(lutInfo.value);
    } catch (e) {
      console.warn("Failed to fetch Save pool LUT:", e);
    }
  }

  const kaminoLuts = await fetchKaminoLookupTables(
    connection,
    kaminoMarketAddress,
    kaminoMarket,
    kaminoOwner,
    collateralMint,
    debtMint,
  );

  const jupLendLuts: AddressLookupTableAccount[] = [];
  if (auxJupLendVaultId != null) {
    const jlut = await fetchJupLendVaultLut(
      connection,
      auxJupLendVaultId,
      walletPublicKey,
    );
    if (jlut) jupLendLuts.push(jlut);
  }

  return {
    instructions: allInstructions,
    lookupTables: mergeLookupTables([
      ...kaminoLuts,
      ...saveLuts,
      ...jupLendLuts,
    ]),
  };
}

// SAVE TO KAMINO
export interface PrepareSaveToKaminoRefinanceParams {
  savePoolAddress: string;
  saveAuthorityAddress: string;
  saveLookupTableAddress?: string;
  saveCollateralReserve: SaveReserveDescriptor;
  saveDebtReserve: SaveReserveDescriptor;
  saveAllReserves: SaveReserveDescriptor[];

  kaminoMarketAddress: string;

  collateralMint: string;
  debtMint: string;

  // JupLend vault used purely for its LUT (flash-borrow / flash-payback
  // ixs reference per-asset accounts that aren't in any other LUT).
  // Optional — if missing the LUT step is skipped, may risk tx-size error.
  auxJupLendVaultId?: number;

  collateralAmountRaw: BN;
  debtAmountRaw: BN;
  isMax: boolean;
  isDebtMax: boolean;

  walletPublicKey: PublicKey;
  connection: Connection;
}

export async function prepareSaveToKaminoRefinance(
  params: PrepareSaveToKaminoRefinanceParams,
): Promise<PreparedRefinance> {
  const {
    savePoolAddress,
    saveAuthorityAddress,
    saveLookupTableAddress,
    saveCollateralReserve,
    saveDebtReserve,
    saveAllReserves,
    kaminoMarketAddress,
    collateralMint,
    debtMint,
    auxJupLendVaultId,
    collateralAmountRaw,
    debtAmountRaw,
    isMax,
    isDebtMax,
    walletPublicKey,
    connection,
  } = params;

  if (collateralAmountRaw.lte(new BN(0))) {
    throw new Error("Refinance collateral amount must be positive.");
  }
  if (debtAmountRaw.lte(new BN(0))) {
    throw new Error(
      "Save to Kamino refinance requires a non-zero debt amount.",
    );
  }

  const debtBuffered = applyDebtBuffer(debtAmountRaw);

  // ── Save obligation (must already exist — refinancing OUT of Save) ──
  const saveLendingMarket = new PublicKey(savePoolAddress);
  const saveLendingMarketAuthority = new PublicKey(saveAuthorityAddress);
  const seed = saveLendingMarket.toBase58().slice(0, 32);
  const saveObligationAddress = await PublicKey.createWithSeed(
    walletPublicKey,
    seed,
    SAVE_PROGRAM_ID,
  );

  const saveObligationInfo = await connection.getAccountInfo(
    saveObligationAddress,
  );
  if (!saveObligationInfo) {
    throw new Error(
      "Save obligation account not found — nothing to refinance from Save.",
    );
  }
  const parsed = parseObligation(saveObligationAddress, saveObligationInfo);
  if (!parsed) throw new Error("Failed to parse Save obligation.");

  const existingDepositReserves = parsed.info.deposits
    .filter((d) => !d.depositedAmount.isZero())
    .map((d) => d.depositReserve);
  const existingBorrowReserves = parsed.info.borrows
    .filter((b) => !b.borrowedAmountWads.isZero())
    .map((b) => b.borrowReserve);

  // ── Withdraw amount conversion (liquidity → cToken) ───────────────────
  let withdrawAmount: BN;
  if (isMax) {
    withdrawAmount = new BN(U64_MAX);
  } else {
    const reserveInfo = await connection.getAccountInfo(
      new PublicKey(saveCollateralReserve.address),
    );
    if (!reserveInfo) {
      throw new Error("Failed to load Save reserve for withdraw conversion.");
    }
    const parsedReserve = parseReserve(
      new PublicKey(saveCollateralReserve.address),
      reserveInfo,
    );
    if (!parsedReserve) {
      throw new Error("Failed to parse Save reserve for withdraw conversion.");
    }
    const formatted = formatReserve(parsedReserve);
    const rate = formatted.cTokenExchangeRate.toNumber();
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Save cToken exchange rate is invalid.");
    }
    const liquidityNum = Number(collateralAmountRaw.toString());
    const cTokenNum = Math.ceil(liquidityNum / rate);
    withdrawAmount = new BN(cTokenNum.toString());
  }

  const isDebtSol = debtMint === SOL_MINT;
  const isCollateralSol = collateralMint === SOL_MINT;

  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, walletPublicKey);
  if (isDebtSol || isCollateralSol) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        wsolAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
    );
  }

  // Save debt liquidity ATA (non-SOL; SOL case uses wsolAta)
  const userDebtLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(debtMint),
    walletPublicKey,
  );
  if (!isDebtSol) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        userDebtLiquidityAta,
        walletPublicKey,
        new PublicKey(debtMint),
      ),
    );
  }

  // Save collateral liquidity + cToken ATAs
  const userColLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(saveCollateralReserve.mint),
    walletPublicKey,
  );
  const userColCTokenAta = getAssociatedTokenAddressSync(
    new PublicKey(saveCollateralReserve.collateralMintAddress),
    walletPublicKey,
  );
  preIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      walletPublicKey,
      userColCTokenAta,
      walletPublicKey,
      new PublicKey(saveCollateralReserve.collateralMintAddress),
    ),
  );
  if (!isCollateralSol) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        userColLiquidityAta,
        walletPublicKey,
        new PublicKey(saveCollateralReserve.mint),
      ),
    );
  }

  // ── Flash borrow ─────────────────────────────────────────────────────
  const flashBorrowIx = await getFlashBorrowIx({
    amount: debtBuffered,
    asset: new PublicKey(debtMint),
    signer: walletPublicKey,
    connection,
  });

  // ── Save repay ───────────────────────────────────────────────────────
  const repayIx = repayObligationLiquidityInstruction(
    isMax ? new BN(U64_MAX) : debtBuffered,
    userDebtLiquidityAta,
    new PublicKey(saveDebtReserve.liquidityAddress),
    new PublicKey(saveDebtReserve.address),
    saveObligationAddress,
    saveLendingMarket,
    walletPublicKey,
    SAVE_PROGRAM_ID,
  );

  // ── Refresh-reserve set (one ix per reserve in the union) ────────────
  const refreshUnion = dedupePks([
    ...existingDepositReserves,
    ...existingBorrowReserves,
    new PublicKey(saveCollateralReserve.address),
    new PublicKey(saveDebtReserve.address),
  ]);

  const reservesByAddress = new Map(saveAllReserves.map((r) => [r.address, r]));
  const refreshReserveIxs: TransactionInstruction[] = [];
  for (const reserve of refreshUnion) {
    const desc = reservesByAddress.get(reserve.toBase58());
    if (!desc) {
      throw new Error(
        `Save reserve ${reserve.toBase58()} is referenced but not in allReserves.`,
      );
    }
    refreshReserveIxs.push(
      refreshReserveInstruction(
        reserve,
        SAVE_PROGRAM_ID,
        new PublicKey(desc.pythOracle),
        new PublicKey(desc.switchboardOracle),
      ),
    );
  }

  const refreshBorrowReserves = isDebtMax
    ? existingBorrowReserves.filter(
        (r) => r.toBase58() !== saveDebtReserve.address,
      )
    : existingBorrowReserves;
  const refreshDepositReserves = existingDepositReserves;

  const refreshObligationIx = refreshObligationInstruction(
    saveObligationAddress,
    refreshDepositReserves,
    refreshBorrowReserves,
    SAVE_PROGRAM_ID,
  );

  // ── Save withdraw ────────────────────────────────────────────────────
  const withdrawIx = withdrawObligationCollateralAndRedeemReserveLiquidity(
    withdrawAmount,
    new PublicKey(saveCollateralReserve.collateralSupplyAddress),
    userColCTokenAta,
    new PublicKey(saveCollateralReserve.address),
    saveObligationAddress,
    saveLendingMarket,
    saveLendingMarketAuthority,
    userColLiquidityAta,
    new PublicKey(saveCollateralReserve.collateralMintAddress),
    new PublicKey(saveCollateralReserve.liquidityAddress),
    walletPublicKey,
    walletPublicKey,
    SAVE_PROGRAM_ID,
    refreshDepositReserves,
  );
  withdrawIx.keys.push(
    {
      pubkey: new PublicKey(saveCollateralReserve.pythOracle),
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: new PublicKey(saveCollateralReserve.switchboardOracle),
      isSigner: false,
      isWritable: false,
    },
  );

  // ── Kamino deposit + borrow ──────────────────────────────────────────
  const rpc = createSolanaRpc(connection.rpcEndpoint);
  const kaminoMarket = await KaminoMarket.load(
    rpc,
    createAddress(kaminoMarketAddress),
    DEFAULT_RECENT_SLOT_DURATION_MS,
  );
  if (!kaminoMarket) throw new Error("Failed to load Kamino market");
  await kaminoMarket.loadReserves();

  const kaminoOwner = {
    address: createAddress(walletPublicKey.toBase58()),
  } as TransactionSigner;

  let kaminoObligation: KaminoObligation | ObligationType;
  let hasExistingKaminoObligation = false;
  try {
    kaminoObligation = await kaminoMarket.getUserVanillaObligation(
      createAddress(walletPublicKey.toBase58()),
    );
    hasExistingKaminoObligation = !!kaminoObligation;
  } catch {
    kaminoObligation = new VanillaObligation(createAddress(KAMINO_PROGRAM_ID));
  }

  const kaminoAction = await KaminoAction.buildDepositAndBorrowTxns(
    kaminoMarket,
    collateralAmountRaw,
    createAddress(collateralMint),
    debtBuffered,
    createAddress(debtMint),
    kaminoOwner,
    kaminoObligation,
    true, // useV2Ixs
    undefined, // scopeRefreshConfig
    0, // extraComputeBudget
    // includeAtaIxs=false, we manage ATAs ourselves in preIxs. Keeps the
    // tx well under the v0 message limit.
    false,
    false, // requestElevationGroup
    {
      skipInitialization: hasExistingKaminoObligation,
      skipLutCreation: true,
    },
  );

  const kaminoIxs: TransactionInstruction[] = [
    ...kaminoAction.setupIxs
      .map(convertToLegacyInstruction)
      .filter((ix) => ix.programId.toBase58() === KAMINO_PROGRAM_ID),
    convertToLegacyInstruction(kaminoAction.lendingIxs[0]), // deposit
    ...kaminoAction.inBetweenIxs
      .map(convertToLegacyInstruction)
      .filter((ix) => ix.programId.toBase58() === KAMINO_PROGRAM_ID),
    convertToLegacyInstruction(kaminoAction.lendingIxs[1]), // borrow
  ];

  // ── Flash payback ────────────────────────────────────────────────────
  const flashPaybackIx = await getFlashPaybackIx({
    amount: debtBuffered,
    asset: new PublicKey(debtMint),
    signer: walletPublicKey,
    connection,
  });

  // ── Stitch ───────────────────────────────────────────────────────────
  const allInstructions: TransactionInstruction[] = [
    ...preIxs,
    flashBorrowIx,
    repayIx,
    ...refreshReserveIxs,
    refreshObligationIx,
    withdrawIx,
    ...kaminoIxs,
    flashPaybackIx,
    ...postIxs,
  ];

  // ── Lookup tables ────────────────────────────────────────────────────
  const saveLuts: AddressLookupTableAccount[] = [];
  if (saveLookupTableAddress) {
    try {
      const lutInfo = await connection.getAddressLookupTable(
        new PublicKey(saveLookupTableAddress),
      );
      if (lutInfo.value) saveLuts.push(lutInfo.value);
    } catch (e) {
      console.warn("Failed to fetch Save pool LUT:", e);
    }
  }

  const kaminoLuts = await fetchKaminoLookupTables(
    connection,
    kaminoMarketAddress,
    kaminoMarket,
    kaminoOwner,
    collateralMint,
    debtMint,
  );

  const jupLendLuts: AddressLookupTableAccount[] = [];
  if (auxJupLendVaultId != null) {
    const jlut = await fetchJupLendVaultLut(
      connection,
      auxJupLendVaultId,
      walletPublicKey,
    );
    if (jlut) jupLendLuts.push(jlut);
  }

  return {
    instructions: allInstructions,
    lookupTables: mergeLookupTables([
      ...kaminoLuts,
      ...saveLuts,
      ...jupLendLuts,
    ]),
  };
}

export interface JupLendPositionLite {
  id: number;
  vaultId: number;
  supplyRaw: string;
  borrowRaw: string;
  isLiquidated: boolean;
}

export function pickJupLendPositionId(
  positions: JupLendPositionLite[] | undefined | null,
  vaultId: number,
): number {
  if (!positions || positions.length === 0) return 0;
  const matching = positions.filter(
    (p) => +p.vaultId === +vaultId && !p.isLiquidated,
  );
  if (matching.length === 0) return 0;

  const empty = matching.find(
    (p) => p.supplyRaw === "0" && p.borrowRaw === "0",
  );
  if (empty) return empty.id;

  const latest = [...matching].sort((a, b) => b.id - a.id)[0];
  return latest?.id ?? 0;
}

function dedupePks(pks: PublicKey[]): PublicKey[] {
  const seen = new Map<string, PublicKey>();
  for (const p of pks) seen.set(p.toBase58(), p);
  return [...seen.values()];
}

function mergeLookupTables(
  tables: AddressLookupTableAccount[],
): AddressLookupTableAccount[] {
  const seen = new Map<string, AddressLookupTableAccount>();
  for (const t of tables) seen.set(t.key.toBase58(), t);
  return [...seen.values()];
}
