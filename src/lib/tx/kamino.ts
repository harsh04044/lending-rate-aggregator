"use client";

import {
  DEFAULT_RECENT_SLOT_DURATION_MS,
  KaminoAction,
  KaminoMarket,
  VanillaObligation,
  PROGRAM_ID as KAMINO_PROGRAM_ID,
  type KaminoObligation,
  type ObligationType,
  U64_MAX,
} from "@kamino-finance/klend-sdk";
import {
  AccountRole,
  address as createAddress,
  createSolanaRpc,
  type TransactionSigner,
} from "@solana/kit";
import {
  PublicKey,
  TransactionInstruction,
  type AddressLookupTableAccount,
  type Connection,
} from "@solana/web3.js";
import BN from "bn.js";

const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const KAMINO_JLP_MARKET = "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek";
const JLP_MINT = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4";

const getKaminoMarketAddress = (collateralMint: string): string =>
  collateralMint === JLP_MINT ? KAMINO_JLP_MARKET : KAMINO_MAIN_MARKET;

// Kamino SDK emits @solana/kit Instruction objects, we need legacy
// web3.js TransactionInstructions to pass into a v0 message builder. Kit's
// Instruction generics don't line up cleanly with this shape, so we accept
// unknown and narrow at runtime.
export const convertToLegacyInstruction = (
  raw: unknown,
): TransactionInstruction => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ix = raw as any;
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId ?? ix.programAddress),
    keys:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ix.accounts?.map((acc: any) => ({
        pubkey: new PublicKey(acc.address ?? acc.pubkey),
        isSigner:
          acc.role === AccountRole.WRITABLE_SIGNER ||
          acc.role === AccountRole.READONLY_SIGNER,
        isWritable:
          acc.role === AccountRole.WRITABLE ||
          acc.role === AccountRole.WRITABLE_SIGNER,
      })) ??
      ix.keys ??
      [],
    data:
      ix.data instanceof Uint8Array
        ? Buffer.from(ix.data)
        : (ix.data ?? Buffer.from([])),
  });
};

export interface PrepareKaminoCreateParams {
  collateralMint: string;
  debtMint: string;
  collateralAmountRaw: BN;
  debtAmountRaw: BN;
  walletPublicKey: PublicKey;
  connection: Connection;
}

export interface PreparedTx {
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}

export async function prepareKaminoCreatePosition({
  collateralMint,
  debtMint,
  collateralAmountRaw,
  debtAmountRaw,
  walletPublicKey,
  connection,
}: PrepareKaminoCreateParams): Promise<PreparedTx> {
  const rpc = createSolanaRpc(connection.rpcEndpoint);
  const marketAddress = getKaminoMarketAddress(collateralMint);

  const market = await KaminoMarket.load(
    rpc,
    createAddress(marketAddress),
    DEFAULT_RECENT_SLOT_DURATION_MS,
  );
  if (!market) throw new Error("Failed to load Kamino market");
  await market.loadReserves();

  // KaminoAction only needs the address of the signer for ix building, the
  // actual signing happens later in buildAndSendV0Tx.
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
  const hasDebt = debtAmountRaw.gt(new BN(0));

  const instructions: TransactionInstruction[] = [];

  if (hasDebt) {
    const action = await KaminoAction.buildDepositAndBorrowTxns(
      market,
      collateralAmountRaw,
      depositMint,
      debtAmountRaw,
      borrowMint,
      owner,
      obligation,
      true, // useV2Ixs
      undefined, // scopeRefreshConfig
      0, // extraComputeBudget
      true, // includeAtaIxs — let Kamino handle wSOL wrap/unwrap
      false, // requestElevationGroup
      { skipInitialization: hasExistingObligation, skipLutCreation: true },
    );

    instructions.push(
      ...action.setupIxs.map(convertToLegacyInstruction),
      convertToLegacyInstruction(action.lendingIxs[0]),
      ...action.inBetweenIxs
        .map(convertToLegacyInstruction)
        .filter((ix) => ix.programId.toBase58() === KAMINO_PROGRAM_ID),
      convertToLegacyInstruction(action.lendingIxs[1]),
      ...action.cleanupIxs.map(convertToLegacyInstruction),
    );
  } else {
    const action = await KaminoAction.buildDepositTxns(
      market,
      collateralAmountRaw,
      depositMint,
      owner,
      obligation,
      true, // useV2Ixs
      undefined, // scopeRefreshConfig
      0, // extraComputeBudget
      true, // includeAtaIxs
      false, // requestElevationGroup
      { skipInitialization: hasExistingObligation, skipLutCreation: true },
    );

    instructions.push(
      ...action.setupIxs.map(convertToLegacyInstruction),
      ...action.lendingIxs.map(convertToLegacyInstruction),
      ...action.cleanupIxs.map(convertToLegacyInstruction),
    );
  }

  // No LUTs for now, plain deposit/borrow ixs typically fit in a single v0
  // tx without them. If we hit tx-size limits, fetch user LUT via
  // market.getUserMetadata and the market-wide LUT address.
  return { instructions, lookupTables: [] };
}

// Update flows: supply / withdraw / borrow / repay
//
// All four operate on an existing obligation. They share the same scaffold:
//   1. Load the market for this position.
//   2. Load the user's existing vanilla obligation (must exist).
//   3. Build a KaminoAction via the matching SDK builder.
//   4. Convert kit Instructions → legacy ixs and stitch in setup/cleanup.
//
// Withdraw and Repay accept a `useFullAmount` flag → pass U64_MAX as the
// amount, which Kamino's program treats as "operate on the entire balance
// at execution time". Same dust-floor mechanics as JupLend.

// U64_MAX as a string sentinel. Kamino's KaminoAction signature accepts
// `string | BN`, and the on-chain program checks for equality with U64_MAX.

export interface PrepareKaminoUpdateParams {
  marketAddress: string;
  /** The token mint being acted on (e.g. SOL for a SOL collateral row). */
  mint: string;
  /** Raw amount in token base units. Ignored when `useFullAmount` is true. */
  amountRaw: BN;
  /** When true, sends U64_MAX → withdraw all / repay all. */
  useFullAmount?: boolean;
  walletPublicKey: PublicKey;
  connection: Connection;
}

async function loadMarketAndObligation(
  marketAddress: string,
  walletPublicKey: PublicKey,
  connection: Connection,
): Promise<{
  market: KaminoMarket;
  owner: TransactionSigner;
  obligation: KaminoObligation;
}> {
  const rpc = createSolanaRpc(connection.rpcEndpoint);
  const market = await KaminoMarket.load(
    rpc,
    createAddress(marketAddress),
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

  return { market, owner, obligation };
}

function flatten(action: KaminoAction): TransactionInstruction[] {
  return [
    ...action.setupIxs.map(convertToLegacyInstruction),
    ...action.lendingIxs.map(convertToLegacyInstruction),
    ...action.cleanupIxs.map(convertToLegacyInstruction),
  ];
}

export async function prepareKaminoSupply({
  marketAddress,
  mint,
  amountRaw,
  walletPublicKey,
  connection,
}: PrepareKaminoUpdateParams): Promise<PreparedTx> {
  const { market, owner, obligation } = await loadMarketAndObligation(
    marketAddress,
    walletPublicKey,
    connection,
  );

  const action = await KaminoAction.buildDepositTxns(
    market,
    amountRaw,
    createAddress(mint),
    owner,
    obligation,
    true, // useV2Ixs
    undefined, // scopeRefreshConfig
    0, // extraComputeBudget
    true, // includeAtaIxs — Kamino handles wSOL wrap/unwrap
    false, // requestElevationGroup
    { skipInitialization: true, skipLutCreation: true },
  );

  return { instructions: flatten(action), lookupTables: [] };
}

export async function prepareKaminoWithdraw({
  marketAddress,
  mint,
  amountRaw,
  useFullAmount = false,
  walletPublicKey,
  connection,
}: PrepareKaminoUpdateParams): Promise<PreparedTx> {
  const { market, owner, obligation } = await loadMarketAndObligation(
    marketAddress,
    walletPublicKey,
    connection,
  );

  const amount = useFullAmount ? U64_MAX : amountRaw;

  const action = await KaminoAction.buildWithdrawTxns(
    market,
    amount,
    createAddress(mint),
    owner,
    obligation,
    true, // useV2Ixs
    undefined, // scopeRefreshConfig
    0, // extraComputeBudget
    true, // includeAtaIxs
    false, // requestElevationGroup
    { skipInitialization: true, skipLutCreation: true },
  );

  return { instructions: flatten(action), lookupTables: [] };
}

export async function prepareKaminoBorrow({
  marketAddress,
  mint,
  amountRaw,
  walletPublicKey,
  connection,
}: PrepareKaminoUpdateParams): Promise<PreparedTx> {
  const { market, owner, obligation } = await loadMarketAndObligation(
    marketAddress,
    walletPublicKey,
    connection,
  );

  const action = await KaminoAction.buildBorrowTxns(
    market,
    amountRaw,
    createAddress(mint),
    owner,
    obligation,
    true, // useV2Ixs
    undefined, // scopeRefreshConfig
    0, // extraComputeBudget
    true, // includeAtaIxs
    false, // requestElevationGroup
    { skipInitialization: true, skipLutCreation: true },
  );

  return { instructions: flatten(action), lookupTables: [] };
}

export async function prepareKaminoRepay({
  marketAddress,
  mint,
  amountRaw,
  useFullAmount = false,
  walletPublicKey,
  connection,
}: PrepareKaminoUpdateParams): Promise<PreparedTx> {
  const rpc = createSolanaRpc(connection.rpcEndpoint);
  const { market, owner, obligation } = await loadMarketAndObligation(
    marketAddress,
    walletPublicKey,
    connection,
  );

  const amount = useFullAmount ? U64_MAX : amountRaw;

  // Repay needs the current slot to validate fresh oracle prices.
  const currentSlot = await rpc.getSlot().send();

  const action = await KaminoAction.buildRepayTxns(
    market,
    amount,
    createAddress(mint),
    owner,
    obligation,
    true, // useV2Ixs
    undefined, // scopeRefreshConfig
    currentSlot,
    undefined, // payer (defaults to owner)
    0, // extraComputeBudget
    true, // includeAtaIxs
    false, // requestElevationGroup
    { skipInitialization: true, skipLutCreation: true },
  );

  return { instructions: flatten(action), lookupTables: [] };
}
