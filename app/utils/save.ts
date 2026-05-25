import { Connection, PublicKey } from "@solana/web3.js";
import { Asset, NormalizedPosition, Protocol } from "../types/main";
import { SAVE_PROGRAM_ID } from "@/app/lib/solend-sdk/constants";
import {
  parseObligation,
  formatObligation,
} from "@/app/lib/solend-sdk/obligation";
import {
  parseReserve,
  formatReserve,
  type FormattedReserveType,
} from "@/app/lib/solend-sdk/reserve";
import { HeliusTransaction } from "./helius";
import {
  ActionType,
  HistoryEntry,
  SAVE_INSTRUCTION_MAP,
} from "../lib/discriminators";
import bs58 from "bs58";
import { getTokenInfo } from "../lib/token-registry";
import { computeWeightedRisk } from "./main";
import { MarketPairStats } from "../types";
const SAVE_API_URL = "https://api.save.finance/v1/markets/configs";

let _connection: Connection | null = null;

function getConnection(): Connection {
  if (!_connection) {
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) throw new Error("RPC_URL not configured");
    _connection = new Connection(rpcUrl, "confirmed");
  }
  return _connection;
}

// ─── Market Config Types ─────────────────────────────────────────────────────

interface SaveReserveConfig {
  address: string;
  liquidityToken: {
    mint: string;
    symbol: string;
    name: string;
    decimals: number;
    logo: string | null;
  };
  liquidityAddress: string;
  collateralMintAddress: string;
  collateralSupplyAddress: string;
  pythOracle: string;
  switchboardOracle: string;
  liquidityFeeReceiverAddress: string;
}

interface SaveMarketConfig {
  address: string;
  name: string;
  authorityAddress: string;
  isPermissionless: boolean;
  hidden: boolean;
  lookupTableAddress?: string;
  reserves: SaveReserveConfig[];
}

// ─── Market Config Cache ─────────────────────────────────────────────────────

let cachedMarketConfigs: SaveMarketConfig[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 1000 * 60 * 10; // 10 minutes

// Lean descriptor shape sent to the client tx-builder. Only the fields
// needed to construct ixs — strips logo / symbol / name. Mirrors the shape
// that the market-comparison route emits, so client-side handlers can
// consume both endpoints uniformly.
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

function toReserveDescriptor(r: SaveReserveConfig): SaveReserveDescriptor {
  return {
    address: r.address,
    mint: r.liquidityToken.mint,
    decimals: r.liquidityToken.decimals,
    liquidityAddress: r.liquidityAddress,
    collateralMintAddress: r.collateralMintAddress,
    collateralSupplyAddress: r.collateralSupplyAddress,
    liquidityFeeReceiverAddress: r.liquidityFeeReceiverAddress,
    pythOracle: r.pythOracle,
    switchboardOracle: r.switchboardOracle,
  };
}

function isAllowedPool(pool: SaveMarketConfig): boolean {
  return (
    !pool.isPermissionless &&
    !pool.hidden &&
    (pool.name === "main" || pool.name === "JLP") // Only these two pools now, might increase in the future
  );
}

async function fetchSaveMarketConfigs(): Promise<SaveMarketConfig[]> {
  const now = Date.now();

  if (cachedMarketConfigs && now - cacheTimestamp < CACHE_TTL) {
    return cachedMarketConfigs;
  }

  const response = await fetch(SAVE_API_URL).then((res) => {
    if (!res.ok) throw new Error(`Save API error: ${res.status}`);
    return res.json() as Promise<SaveMarketConfig[]>;
  });

  cachedMarketConfigs = response.filter(isAllowedPool);
  cacheTimestamp = now;

  return cachedMarketConfigs;
}

// ─── Price Fallback ─────────────────────────────────────────────────────────
// TODO: Jupiter Price API fallback for tokens where reserve oracle price is missing
// fetchJupiterPrices(mints: string[]) → Map<string, number>
// Batch call to https://api.jup.ag/price/v2?ids=mint1,mint2,...

// ─── Reserve Cache ───────────────────────────────────────────────────────────

const reserveCache = new Map<
  string,
  { data: FormattedReserveType; timestamp: number }
>();
const RESERVE_CACHE_TTL = 1000 * 60 * 5; // 5 minutes

function getCachedReserve(address: string): FormattedReserveType | null {
  const entry = reserveCache.get(address);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > RESERVE_CACHE_TTL) {
    reserveCache.delete(address);
    return null;
  }
  return entry.data;
}

function setCachedReserve(address: string, data: FormattedReserveType): void {
  reserveCache.set(address, { data, timestamp: Date.now() });
}

function getLogoUrl(reserve: SaveReserveConfig): string {
  // TODO: Add fallback token logo (Jupiter token list or static mapping).
  return reserve.liquidityToken.logo ?? "";
}

// ─── Per-Pool Processing ─────────────────────────────────────────────────────

async function processPool(
  pool: SaveMarketConfig,
  walletPublicKey: PublicKey,
  connection: Connection,
): Promise<NormalizedPosition | null> {
  const lendingMarket = new PublicKey(pool.address);
  const seed = lendingMarket.toBase58().slice(0, 32);

  const obligationAddress = await PublicKey.createWithSeed(
    walletPublicKey,
    seed,
    SAVE_PROGRAM_ID,
  );

  const obligationAccountInfo =
    await connection.getAccountInfo(obligationAddress);
  if (!obligationAccountInfo) return null;

  const parsed = parseObligation(obligationAddress, obligationAccountInfo);
  if (!parsed) return null;

  const { deposits, borrows } = parsed.info;

  const activeDeposits = deposits.filter((d) => !d.depositedAmount.isZero());
  const activeBorrows = borrows.filter((b) => !b.borrowedAmountWads.isZero());

  if (activeDeposits.length === 0 && activeBorrows.length === 0) return null;

  // Collect all involved reserve addresses
  const involvedReserveAddresses = [
    ...new Set([
      ...activeDeposits.map((d) => d.depositReserve.toBase58()),
      ...activeBorrows.map((b) => b.borrowReserve.toBase58()),
    ]),
  ];

  // Check cache first, only fetch uncached reserves from chain
  const reserveMap: { [key: string]: FormattedReserveType } = {};
  const uncachedAddresses: string[] = [];

  for (const addr of involvedReserveAddresses) {
    const cached = getCachedReserve(addr);
    if (cached) {
      reserveMap[addr] = cached;
    } else {
      uncachedAddresses.push(addr);
    }
  }

  // Batch fetch uncached reserves
  if (uncachedAddresses.length > 0) {
    // TODO: Add timeout wrapper for RPC calls to prevent hanging requests.
    const reserveAccountInfos = await connection.getMultipleAccountsInfo(
      uncachedAddresses.map((addr) => new PublicKey(addr)),
    );

    const poolReservesMap = new Map(pool.reserves.map((r) => [r.address, r]));

    uncachedAddresses.forEach((reserveAddress, index) => {
      const accountInfo = reserveAccountInfos[index];
      if (!accountInfo) return;

      const config = poolReservesMap.get(reserveAddress);
      if (!config) return;

      try {
        const parsedReserveData = parseReserve(
          new PublicKey(reserveAddress),
          accountInfo,
        );
        if (!parsedReserveData) return;

        const formatted = formatReserve(
          parsedReserveData,
          undefined,
          undefined,
          {
            symbol: config.liquidityToken.symbol,
            logo: config.liquidityToken.logo ?? "",
            name: config.liquidityToken.name,
          },
        );

        reserveMap[reserveAddress] = formatted;
        setCachedReserve(reserveAddress, formatted);
      } catch (err) {
        console.warn(`[save] Failed to parse reserve ${reserveAddress}:`, err);
      }
    });
  }

  const poolReservesMap = new Map(pool.reserves.map((r) => [r.address, r]));

  // Use SDK's formatObligation for health
  const formattedObligation = formatObligation(parsed, reserveMap);

  // Helper: get price for a reserve
  // TODO: add Jupiter Price API fallback when reserve oracle price is missing
  function getPrice(reserveAddress: string): number {
    const reserveData = reserveMap[reserveAddress];
    if (reserveData?.price && !reserveData.price.isZero()) {
      return reserveData.price.toNumber();
    }
    return 0;
  }

  // Build collateral assets
  const collateralAssets: Asset[] = [];
  let totalCollateralUsd = 0;

  for (const deposit of formattedObligation.deposits) {
    const config = poolReservesMap.get(deposit.reserveAddress);
    if (!config) continue;

    const reserveData = reserveMap[deposit.reserveAddress];
    if (!reserveData) continue;

    const price = getPrice(deposit.reserveAddress);
    const amountUsd = deposit.amount.times(price).toNumber();

    if (amountUsd < 0.01) continue;

    const supplyApy = reserveData.supplyInterest.times(100).toNumber();
    // formatReserve normalizes the u8 config bytes to fractions
    // (e.g. 0.75); multiply by 100 to express as a percentage (75).
    const assetMaxLTV = reserveData.loanToValueRatio * 100;
    const assetLiqThreshold = reserveData.liquidationThreshold * 100;

    collateralAssets.push({
      mint: config.liquidityToken.mint,
      symbol: config.liquidityToken.symbol,
      name: config.liquidityToken.name,
      decimals: config.liquidityToken.decimals,
      logoUrl: getLogoUrl(config),
      amount: deposit.amount.toString(),
      amountUsd,
      price,
      supplyApy,
      maxLTV: Number.isFinite(assetMaxLTV) ? assetMaxLTV : undefined,
      liqThreshold: Number.isFinite(assetLiqThreshold)
        ? assetLiqThreshold
        : undefined,
      meta: { reserveAddress: deposit.reserveAddress },
    });

    totalCollateralUsd += amountUsd;
  }

  // Build debt assets
  const debtAssets: Asset[] = [];
  let totalDebtUsd = 0;

  for (const borrow of formattedObligation.borrows) {
    const config = poolReservesMap.get(borrow.reserveAddress);
    if (!config) continue;

    const reserveData = reserveMap[borrow.reserveAddress];
    if (!reserveData) continue;

    const price = getPrice(borrow.reserveAddress);
    const amountUsd = borrow.amount.times(price).toNumber();

    if (amountUsd < 0.01) continue;

    const borrowApy = reserveData.borrowInterest.times(100).toNumber();

    debtAssets.push({
      mint: config.liquidityToken.mint,
      symbol: config.liquidityToken.symbol,
      name: config.liquidityToken.name,
      decimals: config.liquidityToken.decimals,
      logoUrl: getLogoUrl(config),
      amount: borrow.amount.toString(),
      amountUsd,
      price,
      borrowApy,
      meta: { reserveAddress: borrow.reserveAddress },
    });

    totalDebtUsd += amountUsd;
  }

  if (collateralAssets.length === 0 && debtAssets.length === 0) return null;

  // Health: how far current LTV is from liquidation LTV (0 = at liquidation, 100 = no debt)
  const liquidationThreshold = parseFloat(
    formattedObligation.liquidationThresholdFactor.toString(),
  );
  let healthPct: number;

  if (totalDebtUsd <= 0) {
    healthPct = 100;
  } else if (totalCollateralUsd <= 0) {
    healthPct = 0;
  } else {
    const currentLtv = totalDebtUsd / totalCollateralUsd;
    if (currentLtv >= liquidationThreshold) {
      healthPct = 0;
    } else {
      healthPct =
        ((liquidationThreshold - currentLtv) / liquidationThreshold) * 100;
    }
  }

  // Net APY relative to equity (collateral - debt) to reflect leveraged returns
  const supplyEarnings = collateralAssets.reduce(
    (sum, a) => sum + (a.amountUsd * (a.supplyApy ?? 0)) / 100,
    0,
  );
  const borrowCosts = debtAssets.reduce(
    (sum, a) => sum + (a.amountUsd * (a.borrowApy ?? 0)) / 100,
    0,
  );
  const equity = totalCollateralUsd - totalDebtUsd;
  const netApy =
    equity > 0 ? ((supplyEarnings - borrowCosts) / equity) * 100 : 0;

  return {
    protocol: Protocol.Save,
    label: `Save · ${pool.name}`,
    accountAddress: obligationAddress.toBase58(),
    collateral: collateralAssets,
    debt: debtAssets,
    totalCollateralUsd,
    totalDebtUsd,
    healthPct,
    netApy,
    risk: computeWeightedRisk(collateralAssets),
    meta: {
      poolAddress: pool.address,
      poolName: pool.name,
      authorityAddress: pool.authorityAddress,
      lookupTableAddress: pool.lookupTableAddress,
      // Full per-pool reserve list. The action handler needs it to refresh
      // every reserve the obligation references (not just the one the user
      // clicked) before borrow / withdraw / repay. Avoids a second API hop
      // on the client for the same data the fetcher already loaded.
      allReserves: pool.reserves.map(toReserveDescriptor),
    },
  };
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────

export async function fetchSavePositions(
  wallet: string,
): Promise<NormalizedPosition[]> {
  if (!wallet) return [];

  const connection = getConnection();
  const walletPublicKey = new PublicKey(wallet);

  const pools = await fetchSaveMarketConfigs();

  const settled = await Promise.allSettled(
    pools.map((pool) => processPool(pool, walletPublicKey, connection)),
  );

  return settled
    .filter((r, i) => {
      if (r.status === "rejected") {
        console.error(`[save] Pool ${pools[i].name} failed:`, r.reason);
        return false;
      }
      return r.value !== null;
    })
    .map((r) => (r as PromiseFulfilledResult<NormalizedPosition>).value);
}

// HISTORY
interface SaveInstruction {
  programId: string;
  data: string;
  accounts: string[];
  actionType: ActionType;
}

function findSaveActions(tx: HeliusTransaction): SaveInstruction[] {
  const actions: SaveInstruction[] = [];

  function check(ix: { programId: string; data: string; accounts: string[] }) {
    if (ix.programId !== SAVE_PROGRAM_ID.toString() || !ix.data) return;

    try {
      const dataBuffer = Buffer.from(bs58.decode(ix.data));
      if (dataBuffer.length < 1) return;

      const instructionIndex = dataBuffer[0];
      const actionType = SAVE_INSTRUCTION_MAP[instructionIndex];

      if (actionType) {
        actions.push({
          programId: ix.programId,
          data: ix.data,
          accounts: ix.accounts,
          actionType,
        });
      }
    } catch {}
  }

  for (const ix of tx.instructions) {
    check(ix);
    if (ix.innerInstructions) {
      for (const inner of ix.innerInstructions) {
        check(inner);
      }
    }
  }

  return actions;
}

// Obligation PDA account index varies by Save instruction type
// From solend-sdk instructions layout:
const SAVE_OBLIGATION_ACCOUNT_INDEX: Record<number, number> = {
  14: 5, // depositReserveLiquidityAndObligationCollateral → obligation at index 5
  10: 3, // borrowObligationLiquidity → obligation at index 3
  11: 3, // repayObligationLiquidity → obligation at index 3
  13: 3, // withdrawObligationCollateralAndRedeemReserveLiquidity → obligation at index 3
};

// User's token account (ATA) index + direction per instruction type.
// Used to precisely match the right token transfer even when flash-loan or
// cross-program transfers also appear in tx.tokenTransfers.
const SAVE_USER_TOKEN_ACCOUNT: Record<
  number,
  { index: number; direction: "from" | "to" }
> = {
  14: { index: 0, direction: "from" }, // deposit: sourceLiquidity at accounts[0]
  10: { index: 1, direction: "to" },   // borrow: destinationLiquidity at accounts[1]
  11: { index: 0, direction: "from" }, // repay: sourceLiquidity at accounts[0]
  13: { index: 6, direction: "to" },   // withdraw: destinationLiquidity at accounts[6]
};

export async function processSaveTransaction(
  tx: HeliusTransaction,
  wallet: string,
): Promise<HistoryEntry[]> {
  const actions = findSaveActions(tx);
  if (actions.length === 0) return [];

  const entries: HistoryEntry[] = [];
  // Consume transfers to prevent two same-direction actions from matching the same one
  const availableTransfers = [...tx.tokenTransfers];

  for (const action of actions) {
    const userIsSending =
      action.actionType === "deposit" || action.actionType === "repay";

    let obligationIndex = 3;
    let instructionIndex = -1;
    try {
      const dataBuffer = Buffer.from(bs58.decode(action.data));
      instructionIndex = dataBuffer[0];
      obligationIndex = SAVE_OBLIGATION_ACCOUNT_INDEX[instructionIndex] ?? 3;
    } catch {}

    const tokenAccountInfo = SAVE_USER_TOKEN_ACCOUNT[instructionIndex];
    const userTokenAccount = tokenAccountInfo
      ? (action.accounts?.[tokenAccountInfo.index] ?? "")
      : "";

    let transferIdx = userTokenAccount
      ? availableTransfers.findIndex((t) => {
          if (t.tokenAmount === 0) return false;
          return tokenAccountInfo!.direction === "from"
            ? t.fromTokenAccount === userTokenAccount
            : t.toTokenAccount === userTokenAccount;
        })
      : -1;

    // Fall back to wallet-direction matching if token account lookup fails
    if (transferIdx === -1) {
      transferIdx = availableTransfers.findIndex((t) => {
        if (t.tokenAmount === 0) return false;
        return userIsSending
          ? t.fromUserAccount === wallet
          : t.toUserAccount === wallet;
      });
    }

    if (transferIdx === -1) continue;
    const transfer = availableTransfers.splice(transferIdx, 1)[0];

    const tokenInfo = await getTokenInfo(transfer.mint);
    const tokenSymbol = tokenInfo?.symbol ?? transfer.mint.slice(0, 6);

    entries.push({
      timestamp: tx.timestamp,
      actionType: action.actionType,
      tokens: [{
        tokenSymbol,
        tokenAmount: Math.abs(transfer.tokenAmount).toString(),
        tokenMint: transfer.mint,
        logoUrl: tokenInfo?.logoUrl ?? "",
        // TODO: backfill with the price at tx.timestamp once we have a
        // historical price source; 0 for now so the UI doesn't render USD.
        tokenPrice: 0,
      }],
      signature: tx.signature,
      accountAddress: action.accounts?.[obligationIndex] ?? "",
    });
  }

  return entries;
}

interface SaveReserveConfig {
  address: string;
  liquidityToken: {
    mint: string;
    symbol: string;
    name: string;
    decimals: number;
    logo: string | null;
  };
  liquidityAddress: string;
  collateralMintAddress: string;
  collateralSupplyAddress: string;
  liquidityFeeReceiverAddress: string;
  pythOracle: string;
  switchboardOracle: string;
}

interface SaveMarketConfig {
  address: string;
  name: string;
  authorityAddress: string;
  lookupTableAddress?: string;
  isPermissionless: boolean;
  hidden: boolean;
  reserves: SaveReserveConfig[];
}

export interface SaveMarketPair {
  poolAddress: string;
  poolName: string;
  authorityAddress: string;
  lookupTableAddress?: string;
  collateralReserve: SaveReserveConfig;
  debtReserve?: SaveReserveConfig;
  // Full reserve list of the chosen pool. Lets the tx-builder refresh every
  // reserve an existing obligation references (which may include reserves
  // outside the collateral/debt pair) without a second API call.
  allReserves: SaveReserveConfig[];
  stats: MarketPairStats;
}

export async function findSaveMarketPair(
  collateralMint: string,
  debtMint?: string,
): Promise<SaveMarketPair | null> {
  const connection = getConnection();
  const pools = await fetchSaveMarketConfigs();

  if (!debtMint) {
    // Supply-only: find the best pool by LTV for the collateral token
    const matchingPools = pools
      .map((pool) => ({
        pool,
        collateralReserve: pool.reserves.find(
          (r) => r.liquidityToken.mint === collateralMint,
        ),
      }))
      .filter((x): x is { pool: SaveMarketConfig; collateralReserve: SaveReserveConfig } =>
        x.collateralReserve !== undefined,
      );

    const settled = await Promise.allSettled(
      matchingPools.map(({ collateralReserve }) =>
        connection.getAccountInfo(new PublicKey(collateralReserve.address)).then((info) => {
          if (!info) return null;
          const parsed = parseReserve(new PublicKey(collateralReserve.address), info);
          if (!parsed) return null;
          const formatted = formatReserve(parsed);
          return { ltv: formatted.loanToValueRatio, liquidationThreshold: formatted.liquidationThreshold, supplyApy: formatted.supplyInterest.times(100).toNumber() };
        }),
      ),
    );

    let bestPair: SaveMarketPair | null = null;
    let bestLtv = 0;

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === "rejected" || !result.value) continue;
      const { ltv, liquidationThreshold, supplyApy } = result.value;
      if (ltv > bestLtv) {
        bestLtv = ltv;
        bestPair = {
          poolAddress: matchingPools[i].pool.address,
          poolName: matchingPools[i].pool.name,
          authorityAddress: matchingPools[i].pool.authorityAddress,
          lookupTableAddress: matchingPools[i].pool.lookupTableAddress,
          collateralReserve: matchingPools[i].collateralReserve,
          allReserves: matchingPools[i].pool.reserves,
          stats: { ltv, liquidationThreshold, supplyApy: supplyApy.toFixed(2) },
        };
      }
    }

    return bestPair;
  }

  // Full pair: filter to pools that have both mints
  const matchingPools = pools
    .map((pool) => ({
      pool,
      collateralReserve: pool.reserves.find(
        (r) => r.liquidityToken.mint === collateralMint,
      ),
      debtReserve: pool.reserves.find(
        (r) => r.liquidityToken.mint === debtMint,
      ),
    }))
    .filter(
      ({ collateralReserve, debtReserve }) =>
        collateralReserve &&
        debtReserve &&
        collateralReserve.address !== debtReserve.address,
    ) as {
    pool: SaveMarketConfig;
    collateralReserve: SaveReserveConfig;
    debtReserve: SaveReserveConfig;
  }[];

  const settled = await Promise.allSettled(
    matchingPools.map(({ pool, collateralReserve, debtReserve }) =>
      Promise.all([
        connection.getAccountInfo(new PublicKey(collateralReserve.address)),
        connection.getAccountInfo(new PublicKey(debtReserve.address)),
      ]).then(([collateralAccountInfo, debtAccountInfo]) => {
        if (!collateralAccountInfo || !debtAccountInfo) return null;

        const parsedCollateral = parseReserve(
          new PublicKey(collateralReserve.address),
          collateralAccountInfo,
        );
        const parsedDebt = parseReserve(
          new PublicKey(debtReserve.address),
          debtAccountInfo,
        );

        if (!parsedCollateral || !parsedDebt) return null;

        const formattedCollateral = formatReserve(parsedCollateral);
        const formattedDebt = formatReserve(parsedDebt);

        const ltv = formattedCollateral.loanToValueRatio;
        if (ltv === 0) return null;

        return {
          pool,
          collateralReserve,
          debtReserve,
          ltv,
          liquidationThreshold: formattedCollateral.liquidationThreshold,
          supplyApy: formattedCollateral.supplyInterest.times(100).toNumber(),
          borrowApy: formattedDebt.borrowInterest.times(100).toNumber(),
        };
      }),
    ),
  );

  let bestPair: SaveMarketPair | null = null;
  let bestLtv = 0;

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "rejected") {
      console.warn(
        `[save] Failed to load reserves for pool ${matchingPools[i].pool.name}:`,
        result.reason,
      );
      continue;
    }
    if (!result.value) continue;

    const { pool, collateralReserve, debtReserve, ltv, liquidationThreshold, supplyApy, borrowApy } = result.value;

    if (ltv > bestLtv) {
      bestLtv = ltv;
      bestPair = {
        poolAddress: pool.address,
        poolName: pool.name,
        authorityAddress: pool.authorityAddress,
        lookupTableAddress: pool.lookupTableAddress,
        collateralReserve,
        debtReserve,
        allReserves: pool.reserves,
        stats: {
          ltv,
          liquidationThreshold,
          supplyApy: supplyApy.toFixed(2),
          borrowApy: borrowApy.toFixed(2),
        },
      };
    }
  }

  return bestPair;
}
