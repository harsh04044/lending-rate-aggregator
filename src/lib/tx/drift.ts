"use client";

import {
  DRIFT_PROGRAM_ID,
  DriftClient,
  getMarketsAndOraclesForSubscription,
  getUserAccountPublicKey,
  type Wallet,
} from "@drift-labs/sdk";
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
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
} from "@solana/web3.js";
import BN from "bn.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface PrepareDriftCreateParams {
  collateralMint: string;
  debtMint: string;
  collateralMarketIndex: number;
  debtMarketIndex: number;
  poolId?: number;
  collateralAmountRaw: BN;
  debtAmountRaw: BN;
  walletPublicKey: PublicKey;
  connection: Connection;
}

export interface PreparedTx {
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}

// DriftClient requires a Wallet during construction so it knows the operating
// authority. We never sign through the client (signing happens later in
// buildAndSendV0Tx), so the sign* methods are no-op stubs that throw if
// accidentally invoked, surfacing the bug rather than silently no-op'ing.
function makeStubWallet(publicKey: PublicKey): Wallet {
  const reject = () => {
    throw new Error(
      "DriftClient stub wallet was asked to sign — signing should go through buildAndSendV0Tx, not the DriftClient.",
    );
  };
  return {
    publicKey,
    signTransaction: <T extends Transaction | VersionedTransaction>(
      _tx: T,
    ): Promise<T> => reject(),
    signAllTransactions: <T extends Transaction | VersionedTransaction>(
      _txs: T[],
    ): Promise<T[]> => reject(),
    payer: undefined as never,
  } as unknown as Wallet;
}

export async function prepareDriftCreatePosition({
  collateralMint,
  debtMint,
  collateralMarketIndex,
  debtMarketIndex,
  poolId,
  collateralAmountRaw,
  debtAmountRaw,
  walletPublicKey,
  connection,
}: PrepareDriftCreateParams): Promise<PreparedTx> {
  const { perpMarketIndexes, spotMarketIndexes, oracleInfos } =
    getMarketsAndOraclesForSubscription("mainnet-beta");

  const driftClient = new DriftClient({
    // Drift's bundled @solana/web3.js types are slightly older than ours;
    // the runtime shape matches.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: connection as any,
    wallet: makeStubWallet(walletPublicKey),
    env: "mainnet-beta",
    userStats: true,
    perpMarketIndexes,
    spotMarketIndexes,
    oracleInfos,
    accountSubscription: {
      type: "websocket",
      resubTimeoutMs: 30000,
      logResubMessages: false,
    },
    activeSubAccountId: 0,
    subAccountIds: [0],
  });

  await driftClient.subscribe();

  try {
    const userPDA = await getUserAccountPublicKey(
      new PublicKey(DRIFT_PROGRAM_ID),
      walletPublicKey,
      0,
    );
    const userAccountInfo = await connection.getAccountInfo(userPDA);
    const userExists = !!userAccountInfo;

    if (userExists) {
      await driftClient.addUser(0);
    }

    const isCollateralSol = collateralMint === SOL_MINT;
    const isDebtSol = debtMint === SOL_MINT;
    const hasDebt = debtAmountRaw.gt(new BN(0));

    const preIxs: TransactionInstruction[] = [];
    const postIxs: TransactionInstruction[] = [];

    if (isCollateralSol || (isDebtSol && hasDebt)) {
      const wsolAta = getAssociatedTokenAddressSync(
        NATIVE_MINT,
        walletPublicKey,
      );

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

    const collateralTokenAccount = getAssociatedTokenAddressSync(
      new PublicKey(collateralMint),
      walletPublicKey,
    );

    const depositIxs: TransactionInstruction[] = [];

    if (!userExists) {
      const { ixs } =
        await driftClient.createInitializeUserAccountAndDepositCollateralIxs(
          collateralAmountRaw,
          collateralTokenAccount,
          collateralMarketIndex,
          0, // subAccountId
          undefined, // name
          undefined, // fromSubAccountId
          undefined, // referrerInfo
          undefined, // donateAmount
          undefined, // customMaxMarginRatio
          poolId,
        );
      depositIxs.push(...ixs);
    } else {
      const ix = await driftClient.getDepositInstruction(
        collateralAmountRaw,
        collateralMarketIndex,
        collateralTokenAccount,
        0, // subAccountId
        false, // reduceOnly
      );
      depositIxs.push(ix);
    }

    const borrowIxs: TransactionInstruction[] = [];

    if (hasDebt) {
      const debtTokenAccount = getAssociatedTokenAddressSync(
        new PublicKey(debtMint),
        walletPublicKey,
      );

      // For SOL borrows, the wSOL ATA must exist before withdrawal lands tokens
      // there. The pre-ixs above already create it when isDebtSol, so we're
      // covered. For other tokens, ensure the user's ATA exists.
      if (!isDebtSol) {
        preIxs.push(
          createAssociatedTokenAccountIdempotentInstruction(
            walletPublicKey,
            debtTokenAccount,
            walletPublicKey,
            new PublicKey(debtMint),
          ),
        );
      }

      // getWithdrawIx beyond balance creates a borrow on Drift. The SDK only
      // includes the quote market in remaining accounts, which is insufficient
      // when the user has an active deposit on the collateral market — we
      // replace the tail of withdrawIx.keys with our own remaining accounts
      // that include both the borrow market (writable) and the deposit market
      // (readable). Same trick the JupLend refinance flow uses.
      const withdrawIx = await driftClient.getWithdrawIx(
        debtAmountRaw,
        debtMarketIndex,
        debtTokenAccount,
        false, // reduceOnly
        0, // subAccountId
      );

      // For first-time users, the user account is created in-tx by the init
      // ix above and won't be in the client cache yet. Pass an empty
      // userAccounts list — Drift will derive remaining accounts purely from
      // the writable/readable indices, which is sufficient for the
      // collateral+debt pair we just set up.
      const loadedUserAccount = userExists
        ? driftClient.getUserAccount(0)
        : undefined;
      const userAccounts = loadedUserAccount ? [loadedUserAccount] : [];

      const fullRemainingAccounts = driftClient.getRemainingAccounts({
        userAccounts,
        useMarketLastSlotCache: true,
        writableSpotMarketIndexes: [debtMarketIndex],
        readableSpotMarketIndexes: [collateralMarketIndex],
      });

      const FIXED_ACCOUNTS_COUNT = 8;
      const fixedAccounts = withdrawIx.keys.slice(0, FIXED_ACCOUNTS_COUNT);
      withdrawIx.keys = [...fixedAccounts, ...fullRemainingAccounts];

      borrowIxs.push(withdrawIx);
    }

    const allInstructions = [...preIxs, ...depositIxs, ...borrowIxs, ...postIxs];

    const lookupTables = await driftClient.fetchAllLookupTableAccounts();

    return { instructions: allInstructions, lookupTables };
  } finally {
    await driftClient.unsubscribe().catch(() => {});
  }
}
