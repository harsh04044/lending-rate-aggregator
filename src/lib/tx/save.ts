"use client";

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
import {
  formatReserve,
  parseReserve,
} from "@/app/lib/solend-sdk/reserve";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AddressLookupTableAccount,
  type Connection,
} from "@solana/web3.js";
import BN from "bn.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Lean descriptor shape returned by /api/market-comparison for each Save
// reserve. Contains only the fields the tx-builder needs.
export interface SaveReserveDescriptor {
  address: string;
  mint: string;
  decimals: number;
  liquidityAddress: string;
  collateralMintAddress: string;
  collateralSupplyAddress: string;
  liquidityFeeReceiverAddress: string;
  pythOracle: string;
  switchboardOracle: string;
}

export interface PrepareSaveCreateParams {
  collateralMint: string;
  /** Required only when debtAmountRaw > 0. */
  debtMint?: string;
  poolAddress: string;
  authorityAddress: string;
  lookupTableAddress?: string;
  collateralReserve: SaveReserveDescriptor;
  /** Required only when debtAmountRaw > 0. */
  debtReserve?: SaveReserveDescriptor;
  /** Full reserve list for the pool. Lets us refresh prior-position reserves
   *  on an existing obligation without a second API call. */
  allReserves: SaveReserveDescriptor[];
  collateralAmountRaw: BN;
  debtAmountRaw: BN;
  walletPublicKey: PublicKey;
  connection: Connection;
}

export interface PreparedTx {
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}

export async function prepareSaveCreatePosition({
  collateralMint,
  debtMint,
  poolAddress,
  authorityAddress,
  lookupTableAddress,
  collateralReserve,
  debtReserve,
  allReserves,
  collateralAmountRaw,
  debtAmountRaw,
  walletPublicKey,
  connection,
}: PrepareSaveCreateParams): Promise<PreparedTx> {
  const hasDebt = debtAmountRaw.gt(new BN(0));
  if (hasDebt && !debtReserve) {
    throw new Error("Save debt reserve descriptor is required when borrowing.");
  }
  if (hasDebt && !debtMint) {
    throw new Error("debtMint is required when borrowing.");
  }

  const lendingMarket = new PublicKey(poolAddress);
  const lendingMarketAuthority = new PublicKey(authorityAddress);

  // Obligation account is a PDA derived from wallet + pool seed (first 32
  // chars of pool base58). One obligation per (wallet, pool).
  const seed = lendingMarket.toBase58().slice(0, 32);
  const obligationAddress = await PublicKey.createWithSeed(
    walletPublicKey,
    seed,
    SAVE_PROGRAM_ID,
  );

  const obligationAccountInfo =
    await connection.getAccountInfo(obligationAddress);

  const isCollateralSol = collateralMint === SOL_MINT;
  const isDebtSol = hasDebt && debtMint === SOL_MINT;

  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  // 1. Initialize obligation if missing.
  if (!obligationAccountInfo) {
    const lamports =
      await connection.getMinimumBalanceForRentExemption(OBLIGATION_SIZE);

    preIxs.push(
      SystemProgram.createAccountWithSeed({
        fromPubkey: walletPublicKey,
        newAccountPubkey: obligationAddress,
        basePubkey: walletPublicKey,
        seed,
        lamports,
        space: OBLIGATION_SIZE,
        programId: SAVE_PROGRAM_ID,
      }),
      initObligationInstruction(
        obligationAddress,
        lendingMarket,
        walletPublicKey,
        SAVE_PROGRAM_ID,
      ),
    );
  }

  // 2. wSOL ATA setup (collateral wrap and/or debt unwrap).
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
      preIxs.push(
        SystemProgram.transfer({
          fromPubkey: walletPublicKey,
          toPubkey: wsolAta,
          lamports: BigInt(collateralAmountRaw.toString()),
        }),
        createSyncNativeInstruction(wsolAta),
      );
    }

    postIxs.push(
      createCloseAccountInstruction(wsolAta, walletPublicKey, walletPublicKey),
    );
  }

  // 3. Ensure user's cToken ATA exists for the collateral reserve.
  const userCollateralLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(collateralReserve.mint),
    walletPublicKey,
  );
  const userCollateralCTokenAta = getAssociatedTokenAddressSync(
    new PublicKey(collateralReserve.collateralMintAddress),
    walletPublicKey,
  );
  preIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      walletPublicKey,
      userCollateralCTokenAta,
      walletPublicKey,
      new PublicKey(collateralReserve.collateralMintAddress),
    ),
  );

  // 4. Deposit collateral.
  const depositIx = depositReserveLiquidityAndObligationCollateralInstruction(
    collateralAmountRaw,
    userCollateralLiquidityAta,
    userCollateralCTokenAta,
    new PublicKey(collateralReserve.address),
    new PublicKey(collateralReserve.liquidityAddress),
    new PublicKey(collateralReserve.collateralMintAddress),
    lendingMarket,
    lendingMarketAuthority,
    new PublicKey(collateralReserve.collateralSupplyAddress),
    obligationAddress,
    walletPublicKey,
    new PublicKey(collateralReserve.pythOracle),
    new PublicKey(collateralReserve.switchboardOracle),
    walletPublicKey,
    SAVE_PROGRAM_ID,
  );

  // 5. Build the union of reserves the obligation will reference at the
  //    moment refreshObligation runs. That moment is *after* depositIx (so
  //    deposits include the new collateral) but *before* the borrow ix (so
  //    borrows do NOT yet include the new debt).
  //
  //    For existing obligations we read the on-chain state and merge in the
  //    new collateral. Skipping any reserve here would either error
  //    (ObligationStale / wrong account list) or compute the wrong LTV.
  const reservesByAddress = new Map(allReserves.map((r) => [r.address, r]));

  const depositReserveAddrs = new Set<string>();
  const borrowReserveAddrs = new Set<string>();

  if (obligationAccountInfo) {
    const parsed = parseObligation(obligationAddress, obligationAccountInfo);
    if (parsed) {
      for (const d of parsed.info.deposits) {
        if (!d.depositedAmount.isZero()) {
          depositReserveAddrs.add(d.depositReserve.toBase58());
        }
      }
      for (const b of parsed.info.borrows) {
        if (!b.borrowedAmountWads.isZero()) {
          borrowReserveAddrs.add(b.borrowReserve.toBase58());
        }
      }
    }
  }
  // The new collateral is always part of deposits at refresh time.
  depositReserveAddrs.add(collateralReserve.address);

  const depositReserves = [...depositReserveAddrs].map(
    (addr) => new PublicKey(addr),
  );
  const borrowReserves = [...borrowReserveAddrs].map(
    (addr) => new PublicKey(addr),
  );

  // Refresh every reserve the obligation will reference, plus the new debt
  // reserve (the borrow ix that follows requires it to be fresh in the same
  // tx, even though it isn't in the obligation yet at refresh time).
  const refreshAddrs = new Set<string>([
    ...depositReserveAddrs,
    ...borrowReserveAddrs,
  ]);
  if (hasDebt && debtReserve) refreshAddrs.add(debtReserve.address);

  const refreshReserveIxs: TransactionInstruction[] = [];
  for (const addr of refreshAddrs) {
    const desc = reservesByAddress.get(addr);
    if (!desc) {
      // Existing obligation references a reserve we don't have a descriptor
      // for. Shouldn't happen if backend sent the full pool list; bail
      // loudly rather than silently producing a malformed refresh set.
      throw new Error(
        `Save reserve ${addr} is referenced by the obligation but missing from allReserves.`,
      );
    }
    refreshReserveIxs.push(
      refreshReserveInstruction(
        new PublicKey(desc.address),
        SAVE_PROGRAM_ID,
        new PublicKey(desc.pythOracle),
        new PublicKey(desc.switchboardOracle),
      ),
    );
  }

  const refreshObligationIx = refreshObligationInstruction(
    obligationAddress,
    depositReserves,
    borrowReserves,
    SAVE_PROGRAM_ID,
  );

  // 6. Borrow leg (optional).
  const borrowIxs: TransactionInstruction[] = [];
  if (hasDebt && debtReserve) {
    const userDebtLiquidityAta = getAssociatedTokenAddressSync(
      new PublicKey(debtReserve.mint),
      walletPublicKey,
    );
    if (!isDebtSol) {
      preIxs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          walletPublicKey,
          userDebtLiquidityAta,
          walletPublicKey,
          new PublicKey(debtReserve.mint),
        ),
      );
    }

    const borrowIx = borrowObligationLiquidityInstruction(
      debtAmountRaw,
      new PublicKey(debtReserve.liquidityAddress),
      userDebtLiquidityAta,
      new PublicKey(debtReserve.address),
      new PublicKey(debtReserve.liquidityFeeReceiverAddress),
      obligationAddress,
      lendingMarket,
      lendingMarketAuthority,
      walletPublicKey,
      SAVE_PROGRAM_ID,
      depositReserves,
    );
    borrowIxs.push(borrowIx);
  }

  const instructions = [
    ...preIxs,
    depositIx,
    ...refreshReserveIxs,
    refreshObligationIx,
    ...borrowIxs,
    ...postIxs,
  ];

  // 7. Pool lookup table (optional but keeps the tx within size limits).
  const lookupTables: AddressLookupTableAccount[] = [];
  if (lookupTableAddress) {
    try {
      const lutInfo = await connection.getAddressLookupTable(
        new PublicKey(lookupTableAddress),
      );
      if (lutInfo.value) lookupTables.push(lutInfo.value);
    } catch (e) {
      console.warn("Failed to fetch Save pool LUT:", e);
    }
  }

  return { instructions, lookupTables };
}

// ─── Update flows: supply / withdraw / borrow / repay ────────────────────
//
// All four operate on an existing obligation. Save's program requires every
// reserve the obligation references to be refreshed in the same tx, plus
// the obligation itself, before any borrow / withdraw / repay ix. Supply
// (deposit) doesn't strictly require refresh, but we include it for
// consistency.

export interface PrepareSaveUpdateParams {
  /** Pool address (Save lendingMarket). */
  poolAddress: string;
  /** Pool authority PDA. */
  authorityAddress: string;
  /** Pool LUT, if known — included to keep tx within size limits. */
  lookupTableAddress?: string;
  /** The reserve the user is acting on (the asset row they clicked). */
  reserve: SaveReserveDescriptor;
  /** Full reserve list for the pool. The handler refreshes every reserve
   *  the obligation currently references — not just `reserve` — so the
   *  obligation's recomputed totals match real on-chain state. */
  allReserves: SaveReserveDescriptor[];
  /** Raw amount in the reserve's base units. Ignored when useFullAmount
   *  is true (sentinel U64_MAX is sent instead). */
  amountRaw: BN;
  /** When true, sends U64_MAX as the amount → withdraw all / repay all.
   *  No effect for supply / borrow paths. */
  useFullAmount?: boolean;
  walletPublicKey: PublicKey;
  connection: Connection;
}

interface SaveActionScaffold {
  obligationAddress: PublicKey;
  lendingMarket: PublicKey;
  lendingMarketAuthority: PublicKey;
  refreshReserveIxs: TransactionInstruction[];
  refreshObligationIx: TransactionInstruction;
  /** Reserves the obligation has deposits in at refresh time, ordered for
   *  the borrow ix's `depositReserves` tail. */
  depositReserves: PublicKey[];
}

// Loads the obligation from chain, parses it, and builds the refresh-
// reserves + refresh-obligation ixs for every reserve referenced by the
// obligation. Used by all four update flows. Throws if the obligation
// doesn't exist (update flows require an existing position).
async function buildSaveActionScaffold(
  connection: Connection,
  walletPublicKey: PublicKey,
  poolAddress: string,
  authorityAddress: string,
  allReserves: SaveReserveDescriptor[],
): Promise<SaveActionScaffold> {
  const lendingMarket = new PublicKey(poolAddress);
  const lendingMarketAuthority = new PublicKey(authorityAddress);
  const seed = lendingMarket.toBase58().slice(0, 32);
  const obligationAddress = await PublicKey.createWithSeed(
    walletPublicKey,
    seed,
    SAVE_PROGRAM_ID,
  );

  const obligationAccountInfo =
    await connection.getAccountInfo(obligationAddress);
  if (!obligationAccountInfo) {
    throw new Error(
      "No existing Save obligation for this wallet on this pool.",
    );
  }

  const parsed = parseObligation(obligationAddress, obligationAccountInfo);
  if (!parsed) {
    throw new Error("Failed to parse Save obligation.");
  }

  const depositReserveAddrs = new Set<string>();
  const borrowReserveAddrs = new Set<string>();
  for (const d of parsed.info.deposits) {
    if (!d.depositedAmount.isZero()) {
      depositReserveAddrs.add(d.depositReserve.toBase58());
    }
  }
  for (const b of parsed.info.borrows) {
    if (!b.borrowedAmountWads.isZero()) {
      borrowReserveAddrs.add(b.borrowReserve.toBase58());
    }
  }

  const reservesByAddress = new Map(allReserves.map((r) => [r.address, r]));
  const refreshAddrs = new Set<string>([
    ...depositReserveAddrs,
    ...borrowReserveAddrs,
  ]);

  const refreshReserveIxs: TransactionInstruction[] = [];
  for (const addr of refreshAddrs) {
    const desc = reservesByAddress.get(addr);
    if (!desc) {
      throw new Error(
        `Save reserve ${addr} is referenced by the obligation but missing from allReserves.`,
      );
    }
    refreshReserveIxs.push(
      refreshReserveInstruction(
        new PublicKey(desc.address),
        SAVE_PROGRAM_ID,
        new PublicKey(desc.pythOracle),
        new PublicKey(desc.switchboardOracle),
      ),
    );
  }

  const depositReserves = [...depositReserveAddrs].map(
    (a) => new PublicKey(a),
  );
  const borrowReserves = [...borrowReserveAddrs].map(
    (a) => new PublicKey(a),
  );

  const refreshObligationIx = refreshObligationInstruction(
    obligationAddress,
    depositReserves,
    borrowReserves,
    SAVE_PROGRAM_ID,
  );

  return {
    obligationAddress,
    lendingMarket,
    lendingMarketAuthority,
    refreshReserveIxs,
    refreshObligationIx,
    depositReserves,
  };
}

async function maybeFetchLookupTable(
  connection: Connection,
  lookupTableAddress: string | undefined,
): Promise<AddressLookupTableAccount[]> {
  if (!lookupTableAddress) return [];
  try {
    const lutInfo = await connection.getAddressLookupTable(
      new PublicKey(lookupTableAddress),
    );
    return lutInfo.value ? [lutInfo.value] : [];
  } catch (e) {
    console.warn("Failed to fetch Save pool LUT:", e);
    return [];
  }
}

// ── Supply ──────────────────────────────────────────────────────────────
//
// Adds liquidity to an existing collateral position. Save's deposit ix
// folds the cToken mint+transfer into the same instruction, so we just
// need the user's liquidity ATA and (for SOL) wsol setup.
export async function prepareSaveSupply({
  poolAddress,
  authorityAddress,
  lookupTableAddress,
  reserve,
  allReserves,
  amountRaw,
  walletPublicKey,
  connection,
}: PrepareSaveUpdateParams): Promise<PreparedTx> {
  if (amountRaw.isZero()) {
    throw new Error("Supply amount must be greater than zero.");
  }

  const scaffold = await buildSaveActionScaffold(
    connection,
    walletPublicKey,
    poolAddress,
    authorityAddress,
    allReserves,
  );

  const isSol = reserve.mint === SOL_MINT;
  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  if (isSol) {
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, walletPublicKey);
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        wsolAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
      SystemProgram.transfer({
        fromPubkey: walletPublicKey,
        toPubkey: wsolAta,
        lamports: BigInt(amountRaw.toString()),
      }),
      createSyncNativeInstruction(wsolAta),
    );
    postIxs.push(
      createCloseAccountInstruction(wsolAta, walletPublicKey, walletPublicKey),
    );
  }

  const userLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(reserve.mint),
    walletPublicKey,
  );
  const userCTokenAta = getAssociatedTokenAddressSync(
    new PublicKey(reserve.collateralMintAddress),
    walletPublicKey,
  );
  preIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      walletPublicKey,
      userCTokenAta,
      walletPublicKey,
      new PublicKey(reserve.collateralMintAddress),
    ),
  );

  const depositIx = depositReserveLiquidityAndObligationCollateralInstruction(
    amountRaw,
    userLiquidityAta,
    userCTokenAta,
    new PublicKey(reserve.address),
    new PublicKey(reserve.liquidityAddress),
    new PublicKey(reserve.collateralMintAddress),
    scaffold.lendingMarket,
    scaffold.lendingMarketAuthority,
    new PublicKey(reserve.collateralSupplyAddress),
    scaffold.obligationAddress,
    walletPublicKey,
    new PublicKey(reserve.pythOracle),
    new PublicKey(reserve.switchboardOracle),
    walletPublicKey,
    SAVE_PROGRAM_ID,
  );

  const lookupTables = await maybeFetchLookupTable(
    connection,
    lookupTableAddress,
  );

  return {
    instructions: [
      ...preIxs,
      ...scaffold.refreshReserveIxs,
      scaffold.refreshObligationIx,
      depositIx,
      ...postIxs,
    ],
    lookupTables,
  };
}

// ── Withdraw ────────────────────────────────────────────────────────────
//
// Save's withdraw ix takes a *cToken* amount (not liquidity) and redeems
// to liquidity in the same ix. For partial withdraws we convert
// liquidity → cToken via the reserve's exchange rate at tx-build time.
// For "withdraw all" we skip the conversion and pass U64_MAX.
export async function prepareSaveWithdraw({
  poolAddress,
  authorityAddress,
  lookupTableAddress,
  reserve,
  allReserves,
  amountRaw,
  useFullAmount = false,
  walletPublicKey,
  connection,
}: PrepareSaveUpdateParams): Promise<PreparedTx> {
  if (!useFullAmount && amountRaw.isZero()) {
    throw new Error("Withdraw amount must be greater than zero.");
  }

  const scaffold = await buildSaveActionScaffold(
    connection,
    walletPublicKey,
    poolAddress,
    authorityAddress,
    allReserves,
  );

  // Resolve the cToken amount to send.
  let collateralAmount: BN;
  if (useFullAmount) {
    collateralAmount = new BN(U64_MAX);
  } else {
    // Fetch the reserve account to read the current cToken exchange rate.
    // cTokenAmount = liquidityAmount / cTokenExchangeRate.
    const reserveInfo = await connection.getAccountInfo(
      new PublicKey(reserve.address),
    );
    if (!reserveInfo) {
      throw new Error("Failed to load Save reserve for withdraw conversion.");
    }
    const parsedReserve = parseReserve(
      new PublicKey(reserve.address),
      reserveInfo,
    );
    if (!parsedReserve) {
      throw new Error("Failed to parse Save reserve for withdraw conversion.");
    }
    const formatted = formatReserve(parsedReserve);
    const rate = formatted.cTokenExchangeRate.toNumber();
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(
        "Save reserve cToken exchange rate is invalid — cannot convert.",
      );
    }
    // cTokenAmount = liquidityAmount / cTokenExchangeRate. Number precision
    // is fine here because typical reserves stay well below 2^53 raw units;
    // we floor to keep the redeemed liquidity ≤ what the user asked for.
    const liquidityNum = Number(amountRaw.toString());
    const cTokenNum = Math.floor(liquidityNum / rate);
    collateralAmount = new BN(cTokenNum.toString());
  }

  const isSol = reserve.mint === SOL_MINT;
  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  // Need the user's liquidity ATA as the destination. For SOL we create a
  // wsol ATA up-front and unwrap it after the withdraw lands.
  const userLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(reserve.mint),
    walletPublicKey,
  );
  if (isSol) {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        userLiquidityAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
    );
    postIxs.push(
      createCloseAccountInstruction(
        userLiquidityAta,
        walletPublicKey,
        walletPublicKey,
      ),
    );
  } else {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        userLiquidityAta,
        walletPublicKey,
        new PublicKey(reserve.mint),
      ),
    );
  }

  const userCTokenAta = getAssociatedTokenAddressSync(
    new PublicKey(reserve.collateralMintAddress),
    walletPublicKey,
  );
  preIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      walletPublicKey,
      userCTokenAta,
      walletPublicKey,
      new PublicKey(reserve.collateralMintAddress),
    ),
  );

  const withdrawIx = withdrawObligationCollateralAndRedeemReserveLiquidity(
    collateralAmount,
    new PublicKey(reserve.collateralSupplyAddress),
    userCTokenAta,
    new PublicKey(reserve.address),
    scaffold.obligationAddress,
    scaffold.lendingMarket,
    scaffold.lendingMarketAuthority,
    userLiquidityAta,
    new PublicKey(reserve.collateralMintAddress),
    new PublicKey(reserve.liquidityAddress),
    walletPublicKey,
    walletPublicKey,
    SAVE_PROGRAM_ID,
    scaffold.depositReserves,
  );

  const lookupTables = await maybeFetchLookupTable(
    connection,
    lookupTableAddress,
  );

  return {
    instructions: [
      ...preIxs,
      ...scaffold.refreshReserveIxs,
      scaffold.refreshObligationIx,
      withdrawIx,
      ...postIxs,
    ],
    lookupTables,
  };
}

// ── Borrow ──────────────────────────────────────────────────────────────
export async function prepareSaveBorrow({
  poolAddress,
  authorityAddress,
  lookupTableAddress,
  reserve,
  allReserves,
  amountRaw,
  walletPublicKey,
  connection,
}: PrepareSaveUpdateParams): Promise<PreparedTx> {
  if (amountRaw.isZero()) {
    throw new Error("Borrow amount must be greater than zero.");
  }

  const scaffold = await buildSaveActionScaffold(
    connection,
    walletPublicKey,
    poolAddress,
    authorityAddress,
    allReserves,
  );

  const isSol = reserve.mint === SOL_MINT;
  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  const userLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(reserve.mint),
    walletPublicKey,
  );
  preIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      walletPublicKey,
      userLiquidityAta,
      walletPublicKey,
      isSol ? NATIVE_MINT : new PublicKey(reserve.mint),
    ),
  );
  if (isSol) {
    postIxs.push(
      createCloseAccountInstruction(
        userLiquidityAta,
        walletPublicKey,
        walletPublicKey,
      ),
    );
  }

  const borrowIx = borrowObligationLiquidityInstruction(
    amountRaw,
    new PublicKey(reserve.liquidityAddress),
    userLiquidityAta,
    new PublicKey(reserve.address),
    new PublicKey(reserve.liquidityFeeReceiverAddress),
    scaffold.obligationAddress,
    scaffold.lendingMarket,
    scaffold.lendingMarketAuthority,
    walletPublicKey,
    SAVE_PROGRAM_ID,
    scaffold.depositReserves,
  );

  const lookupTables = await maybeFetchLookupTable(
    connection,
    lookupTableAddress,
  );

  return {
    instructions: [
      ...preIxs,
      ...scaffold.refreshReserveIxs,
      scaffold.refreshObligationIx,
      borrowIx,
      ...postIxs,
    ],
    lookupTables,
  };
}

// ── Repay ───────────────────────────────────────────────────────────────
export async function prepareSaveRepay({
  poolAddress,
  authorityAddress,
  lookupTableAddress,
  reserve,
  allReserves,
  amountRaw,
  useFullAmount = false,
  walletPublicKey,
  connection,
}: PrepareSaveUpdateParams): Promise<PreparedTx> {
  if (!useFullAmount && amountRaw.isZero()) {
    throw new Error("Repay amount must be greater than zero.");
  }

  const scaffold = await buildSaveActionScaffold(
    connection,
    walletPublicKey,
    poolAddress,
    authorityAddress,
    allReserves,
  );

  const liquidityAmount = useFullAmount ? new BN(U64_MAX) : amountRaw;

  const isSol = reserve.mint === SOL_MINT;
  const preIxs: TransactionInstruction[] = [];
  const postIxs: TransactionInstruction[] = [];

  const userLiquidityAta = getAssociatedTokenAddressSync(
    new PublicKey(reserve.mint),
    walletPublicKey,
  );

  if (isSol) {
    // Wrap the user's repay amount + a 1-lamport buffer for the same
    // share-rounding reason JupLend has — Save's repay can pull 1 atomic
    // unit more than the displayed debt due to interest accrual within
    // the slot. Excess is unwrapped via the close ix at the end.
    //
    // For full repay we don't know the exact debt at execution time, so
    // the caller is expected to fund enough wsol in the wrap below by
    // passing the displayed-debt-raw amount (with a small buffer).
    const wrapAmount = useFullAmount
      ? amountRaw // the "displayed debt" the caller computed, used only for wrap sizing
      : amountRaw.add(new BN(1));

    if (wrapAmount.lte(new BN(0))) {
      throw new Error(
        "SOL repay needs a positive wrap amount. For repay-all SOL, pass the displayed debt as amountRaw.",
      );
    }

    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        userLiquidityAta,
        walletPublicKey,
        NATIVE_MINT,
      ),
      SystemProgram.transfer({
        fromPubkey: walletPublicKey,
        toPubkey: userLiquidityAta,
        lamports: BigInt(wrapAmount.toString()),
      }),
      createSyncNativeInstruction(userLiquidityAta),
    );
    postIxs.push(
      createCloseAccountInstruction(
        userLiquidityAta,
        walletPublicKey,
        walletPublicKey,
      ),
    );
  } else {
    preIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        walletPublicKey,
        userLiquidityAta,
        walletPublicKey,
        new PublicKey(reserve.mint),
      ),
    );
  }

  const repayIx = repayObligationLiquidityInstruction(
    liquidityAmount,
    userLiquidityAta,
    new PublicKey(reserve.liquidityAddress),
    new PublicKey(reserve.address),
    scaffold.obligationAddress,
    scaffold.lendingMarket,
    walletPublicKey,
    SAVE_PROGRAM_ID,
  );

  const lookupTables = await maybeFetchLookupTable(
    connection,
    lookupTableAddress,
  );

  return {
    instructions: [
      ...preIxs,
      ...scaffold.refreshReserveIxs,
      scaffold.refreshObligationIx,
      repayIx,
      ...postIxs,
    ],
    lookupTables,
  };
}
