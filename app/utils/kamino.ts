import {
  DEFAULT_RECENT_SLOT_DURATION_MS,
  KaminoMarket,
  KaminoObligation,
  PROGRAM_ID as KAMINO_PROGRAM_ID,
  ReserveStatus,
} from "@kamino-finance/klend-sdk";
import { createSolanaRpc, address as createAddress } from "@solana/kit";
import BN from "bn.js";

// Convert a raw integer string to a human-readable decimal
function formatRawAmount(rawIntStr: string, decimals: number): string {
  if (!rawIntStr || rawIntStr === "0") return "0";
  if (decimals === 0) return rawIntStr;
  const negative = rawIntStr.startsWith("-");
  const digits = negative ? rawIntStr.slice(1) : rawIntStr;
  const padded = digits.padStart(decimals + 1, "0");
  const split = padded.length - decimals;
  const whole = padded.slice(0, split);
  const frac = padded.slice(split).replace(/0+$/, "");
  const result = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${result}` : result;
}

import { Asset, NormalizedPosition, Protocol } from "../types/main";

import { HeliusTransaction } from "./helius";
import {
  ActionType,
  HistoryEntry,
  KAMINO_DISCRIMINATORS,
} from "../lib/discriminators";
import { getTokenInfo, getTokenLogo } from "../lib/token-registry";
import { computeWeightedRisk } from "./main";
import bs58 from "bs58";
import { MarketPairStats } from "../types";

// Constants
const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const KAMINO_JLP_MARKET = "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek";

// TODO: Replace with Redis or shared cache for multi-instance deployments.
const MARKET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const marketCache = new Map<
  string,
  { market: KaminoMarket; timestamp: number }
>();

let _rpc: ReturnType<typeof createSolanaRpc> | null = null;

export function getRpc(): ReturnType<typeof createSolanaRpc> {
  if (!_rpc) {
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) throw new Error("RPC_URL not configured");
    _rpc = createSolanaRpc(rpcUrl);
  }
  return _rpc;
}

export async function getOrLoadMarket(
  marketAddress: string,
): Promise<KaminoMarket | null> {
  const cached = marketCache.get(marketAddress);
  if (cached && Date.now() - cached.timestamp < MARKET_CACHE_TTL_MS) {
    return cached.market;
  }
  const market = await KaminoMarket.load(
    getRpc(),
    createAddress(marketAddress),
    DEFAULT_RECENT_SLOT_DURATION_MS,
  );
  if (!market) return null;
  await market.loadReserves();
  marketCache.set(marketAddress, { market, timestamp: Date.now() });
  return market;
}

interface MarketConfig {
  address: string;
  label: string;
}

const MARKETS: MarketConfig[] = [
  { address: KAMINO_MAIN_MARKET, label: "Main" },
  { address: KAMINO_JLP_MARKET, label: "JLP" },
];

type ObligationTypeConfig = {
  type: "vanilla"; // TODO: add "multiply" later
  label: string;
};

const OBLIGATION_TYPES: ObligationTypeConfig[] = [
  { type: "vanilla", label: "" },
  // TODO: add multiply obligation scanning — getUserObligationsByTag(1, wallet)
  // Same pattern as vanilla, just filtered by tag. Can add later.
];

// Per-Market-Obligation Processing
async function processObligation(
  market: KaminoMarket,
  marketConfig: MarketConfig,
  obligationType: ObligationTypeConfig,
  walletAddress: string,
  currentSlot: bigint,
): Promise<NormalizedPosition | null> {
  let obligation: KaminoObligation | null = null;

  try {
    if (obligationType.type === "vanilla") {
      obligation = await market.getUserVanillaObligation(
        createAddress(walletAddress),
      );
    }
    // TODO: multiply obligation — getUserObligationsByTag(1, walletAddress)
  } catch (err) {
    // Most "no obligation" cases are quiet, but real errors (RPC, parse,
    // SDK bugs) get swallowed here too. Log so we can tell them apart.
    console.warn(
      `[kamino] getUserVanillaObligation failed for ${walletAddress} on ${marketConfig.label}:`,
      err,
    );
    return null;
  }

  if (!obligation) {
    console.log(
      `[kamino] No vanilla obligation for ${walletAddress} on ${marketConfig.label}`,
    );
    return null;
  }

  console.log(
    `[kamino] Loaded obligation for ${walletAddress} on ${marketConfig.label}: ${obligation.deposits.size} deposits, ${obligation.borrows.size} borrows`,
  );

  // Prefetch all logos in parallel from Jupiter token registry (cached,
  // cheap). Obligation maps are keyed by reserve address — resolve each to
  // its mint via the SDK before fetching logos.
  const involvedMints = new Set<string>();
  for (const reserveAddr of obligation.deposits.keys()) {
    const r = market.getReserveByAddress(createAddress(reserveAddr));
    if (r) involvedMints.add(r.getLiquidityMint().toString());
  }
  for (const reserveAddr of obligation.borrows.keys()) {
    const r = market.getReserveByAddress(createAddress(reserveAddr));
    if (r) involvedMints.add(r.getLiquidityMint().toString());
  }
  const logoEntries = await Promise.all(
    Array.from(involvedMints).map(
      async (mint) => [mint, await getTokenLogo(mint)] as const,
    ),
  );
  const logoMap = new Map(logoEntries);

  // Extract deposits (collateral)
  const collateralAssets: Asset[] = [];
  let totalCollateralUsd = 0;

  // KaminoObligation's `deposits` and `borrows` are keyed by reserve
  // address, so we look up via getReserveByAddress and
  // pull the mint of the reserve itself.
  for (const [reserveAddr, deposit] of obligation.deposits) {
    const reserve = market.getReserveByAddress(createAddress(reserveAddr));
    if (!reserve) {
      console.warn(
        `[kamino] Deposit reserve not found for address ${reserveAddr} on ${marketConfig.label}`,
      );
      continue;
    }

    const mintStr = reserve.getLiquidityMint().toString();
    const decimals = reserve.stats.decimals;
    // Kamino's KaminoObligationDeposit.amount is in raw atomic units (with
    // sub-atomic fractional precision from share-rate math). Floor to an
    // integer raw count, then format as a human-readable decimal string —
    // matches the convention used by the JupLend / Save fetchers.
    const rawIntStr = new BN(deposit.amount.toFixed(0)).toString();
    const amountStr = formatRawAmount(rawIntStr, decimals);
    const amountUsd = deposit.marketValueRefreshed.toNumber();

    if (amountUsd < 0.01) {
      console.log(
        `[kamino] Skipping dust deposit ${amountStr} (${mintStr}) — $${amountUsd.toFixed(6)}`,
      );
      continue;
    }

    const amountNum = parseFloat(amountStr);
    const pricePerToken = amountNum > 0 ? amountUsd / amountNum : 0;
    const supplyApy = reserve.totalSupplyAPY(currentSlot) * 100;

    const symbol = reserve.getTokenSymbol?.() ?? mintStr.slice(0, 6);

    // Kamino reserve stats expose loanToValue / liquidationThreshold as
    // fractions (e.g. 0.74, 0.75). The rest of the codebase normalizes
    // these as percentages (0–100), so scale here to stay consistent with
    // the JupLend / Save fetchers and the CollateralAsset contract.
    const assetMaxLTV = reserve.stats.loanToValue * 100;
    const assetLiqThreshold = reserve.stats.liquidationThreshold * 100;

    collateralAssets.push({
      mint: mintStr,
      symbol,
      name: symbol,
      decimals: reserve.stats.decimals,
      logoUrl: logoMap.get(mintStr) ?? "",
      amount: amountStr,
      amountUsd,
      price: pricePerToken,
      supplyApy,
      maxLTV: Number.isFinite(assetMaxLTV) ? assetMaxLTV : undefined,
      liqThreshold: Number.isFinite(assetLiqThreshold)
        ? assetLiqThreshold
        : undefined,
      meta: { reserveAddress: reserveAddr },
    });

    totalCollateralUsd += amountUsd;
  }

  // Extract borrows (debt)
  const debtAssets: Asset[] = [];
  let totalDebtUsd = 0;

  for (const [reserveAddr, borrow] of obligation.borrows) {
    const reserve = market.getReserveByAddress(createAddress(reserveAddr));
    if (!reserve) {
      console.warn(
        `[kamino] Borrow reserve not found for address ${reserveAddr} on ${marketConfig.label}`,
      );
      continue;
    }

    const mintStr = reserve.getLiquidityMint().toString();
    const decimals = reserve.stats.decimals;
    const rawIntStr = new BN(borrow.amount.toFixed(0)).toString();
    const amountStr = formatRawAmount(rawIntStr, decimals);
    const amountUsd = borrow.marketValueRefreshed.toNumber();

    if (amountUsd < 0.01) {
      console.log(
        `[kamino] Skipping dust borrow ${amountStr} (${mintStr}) — $${amountUsd.toFixed(6)}`,
      );
      continue;
    }

    const amountNum = parseFloat(amountStr);
    const pricePerToken = amountNum > 0 ? amountUsd / amountNum : 0;
    const borrowApy = reserve.totalBorrowAPY(currentSlot) * 100;

    const symbol = reserve.getTokenSymbol?.() ?? mintStr.slice(0, 6);

    debtAssets.push({
      mint: mintStr,
      symbol,
      name: symbol,
      decimals: reserve.stats.decimals,
      logoUrl: logoMap.get(mintStr) ?? "",
      meta: { reserveAddress: reserveAddr },
      amount: amountStr,
      amountUsd,
      price: pricePerToken,
      borrowApy,
    });

    totalDebtUsd += amountUsd;
  }

  if (collateralAssets.length === 0 && debtAssets.length === 0) {
    console.log(
      `[kamino] Obligation on ${marketConfig.label} had positions but all were filtered out (dust or missing reserves)`,
    );
    return null;
  }

  // Health from Kamino SDK — per obligation
  // refreshedStats.loanToValue and liquidationLtv are Decimal types

  // Health: how far current LTV is from liquidation LTV (0 = at liquidation, 100 = no debt)
  const stats = obligation.refreshedStats;
  const loanToValue = stats.loanToValue.toNumber();
  const liquidationLtv = stats.liquidationLtv.toNumber();
  let healthPct: number;

  if (totalDebtUsd <= 0) {
    healthPct = 100;
  } else if (loanToValue >= liquidationLtv) {
    healthPct = 0;
  } else if (liquidationLtv <= 0) {
    healthPct = 0;
  } else {
    healthPct = ((liquidationLtv - loanToValue) / liquidationLtv) * 100;
  }

  healthPct = Math.min(Math.max(healthPct, 0), 100);

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

  // Build label: "Kamino · Main", "Kamino · Main · Multiply", "Kamino · JLP", etc.
  const labelParts = ["Kamino", marketConfig.label];
  if (obligationType.label) labelParts.push(obligationType.label);
  const label = labelParts.join(" · ");

  return {
    protocol: Protocol.Kamino,
    label,
    accountAddress: obligation.obligationAddress.toString(),
    collateral: collateralAssets,
    debt: debtAssets,
    totalCollateralUsd,
    totalDebtUsd,
    healthPct,
    netApy,
    risk: computeWeightedRisk(collateralAssets),
    meta: {
      marketAddress: marketConfig.address,
      marketLabel: marketConfig.label,
      obligationType: obligationType.type,
    },
  };
}

// Fetcher
export async function fetchKaminoPositions(
  wallet: string,
): Promise<NormalizedPosition[]> {
  if (!wallet) return [];

  // TODO: Add timeout wrapper for RPC + SDK calls to prevent hanging requests.
  const currentSlot = await getRpc().getSlot().send();

  // Load both markets in parallel, reusing cached instances where available
  const marketResults = await Promise.all(
    MARKETS.map(async (config) => {
      const market = await getOrLoadMarket(config.address);
      if (!market) return null;
      return { market, config };
    }),
  );

  // For each loaded market, check all obligation types in parallel
  const obligationPromises: Promise<NormalizedPosition | null>[] = [];

  for (const result of marketResults) {
    if (!result) continue;

    for (const oblType of OBLIGATION_TYPES) {
      obligationPromises.push(
        processObligation(
          result.market,
          result.config,
          oblType,
          wallet,
          BigInt(currentSlot),
        ),
      );
    }
  }

  const settled = await Promise.allSettled(obligationPromises);

  return settled
    .filter((r) => {
      if (r.status === "rejected") {
        console.error(`[kamino] Obligation fetch failed:`, r.reason);
        return false;
      }
      return r.value !== null;
    })
    .map((r) => (r as PromiseFulfilledResult<NormalizedPosition>).value);
}

interface KaminoInstruction {
  data: string;
  accounts: string[];
  actionType: ActionType;
  mintAccountIndex: number;
}

// Account indices from @kamino-finance/klend-sdk@5.1.11
// idl_codegen/instructions/*.js — keys[] order is authoritative.
// In all four instructions the obligation is at index 1.
// reserveLiquidityMint position varies per instruction.
const KAMINO_IX_METADATA: Record<
  string,
  { actionType: ActionType; mintAccountIndex: number }
> = {
  // depositReserveLiquidityAndObligationCollateral
  // [owner, obligation, lendingMarket, lendingMarketAuthority, reserve, reserveLiquidityMint, ...]
  [KAMINO_DISCRIMINATORS.deposit]: {
    actionType: "deposit",
    mintAccountIndex: 5,
  },
  // borrowObligationLiquidity
  // [owner, obligation, lendingMarket, lendingMarketAuthority, borrowReserve, borrowReserveLiquidityMint, ...]
  [KAMINO_DISCRIMINATORS.borrow]: {
    actionType: "borrow",
    mintAccountIndex: 5,
  },
  // repayObligationLiquidity
  // [owner, obligation, lendingMarket, repayReserve, reserveLiquidityMint, ...]
  [KAMINO_DISCRIMINATORS.repay]: {
    actionType: "repay",
    mintAccountIndex: 4,
  },
  // withdrawObligationCollateralAndRedeemReserveCollateral
  // [owner, obligation, lendingMarket, lendingMarketAuthority, withdrawReserve, reserveLiquidityMint, ...]
  [KAMINO_DISCRIMINATORS.withdraw]: {
    actionType: "withdraw",
    mintAccountIndex: 5,
  },
};

const OBLIGATION_ACCOUNT_INDEX = 1;

function findKaminoActions(tx: HeliusTransaction): KaminoInstruction[] {
  const actions: KaminoInstruction[] = [];

  function check(ix: { programId: string; data: string; accounts: string[] }) {
    if (ix.programId !== KAMINO_PROGRAM_ID || !ix.data) return;

    try {
      const dataBuffer = Buffer.from(bs58.decode(ix.data));
      if (dataBuffer.length < 8) return;

      const disc = dataBuffer.subarray(0, 8).toString("hex");
      const meta = KAMINO_IX_METADATA[disc];
      if (!meta) return;

      actions.push({
        data: ix.data,
        accounts: ix.accounts,
        actionType: meta.actionType,
        mintAccountIndex: meta.mintAccountIndex,
      });
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

export async function processKaminoTransaction(
  tx: HeliusTransaction,
  wallet: string,
): Promise<HistoryEntry[]> {
  const actions = findKaminoActions(tx);
  if (actions.length === 0) return [];

  const entries: HistoryEntry[] = [];

  for (const action of actions) {
    const reserveMint = action.accounts[action.mintAccountIndex];
    const obligationAddress = action.accounts[OBLIGATION_ACCOUNT_INDEX];
    if (!reserveMint) continue;

    const userIsSending =
      action.actionType === "deposit" || action.actionType === "repay";

    // Find a transfer of this specific mint, in the correct direction.
    // Kamino Multiply / refinance flows compose flash-loans + swaps + lending
    // in one tx, so tokenTransfers can have many unrelated entries — mint +
    // direction filter narrows it to the right one.
    const transfer = tx.tokenTransfers.find((t) => {
      if (t.tokenAmount === 0) return false;
      if (t.mint !== reserveMint) return false;
      return userIsSending
        ? t.fromUserAccount === wallet
        : t.toUserAccount === wallet;
    });

    if (!transfer) continue;

    const tokenInfo = await getTokenInfo(reserveMint);
    const tokenSymbol = tokenInfo?.symbol ?? reserveMint.slice(0, 6);

    entries.push({
      timestamp: tx.timestamp,
      actionType: action.actionType,
      tokens: [{
        tokenSymbol,
        tokenAmount: Math.abs(transfer.tokenAmount).toString(),
        tokenMint: reserveMint,
        logoUrl: tokenInfo?.logoUrl ?? "",
        // TODO: backfill with the price at tx.timestamp once we have a
        // historical price source; 0 for now so the UI doesn't render USD.
        tokenPrice: 0,
      }],
      signature: tx.signature,
      accountAddress: obligationAddress ?? "",
    });
  }

  return entries;
}

const JLP_MINT = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4";

function getKaminoMarketAddress(collateralMint: string): string {
  return collateralMint === JLP_MINT ? KAMINO_JLP_MARKET : KAMINO_MAIN_MARKET;
}

export interface KaminoMarketPair {
  collateralReserveAddress: string;
  debtReserveAddress?: string;
  marketAddress: string;
  stats: MarketPairStats;
}

export async function findKaminoMarketPair(
  collateralMint: string,
  debtMint?: string,
): Promise<KaminoMarketPair | null> {
  const currentSlot = BigInt(await getRpc().getSlot().send());
  const marketAddress = getKaminoMarketAddress(collateralMint);
  const market = await getOrLoadMarket(marketAddress);

  if (!market) return null;
  if (!market.reserves) return null;

  const reservesArray = Array.from(market.reserves.values());

  const collateralReserve = reservesArray.find(
    (r) =>
      r.getLiquidityMint().toString() === collateralMint &&
      r.stats.status === ReserveStatus.Active &&
      !r.stats.reserveDepositLimit.isZero(),
  );

  if (!collateralReserve) return null;

  const supplyApy = (
    collateralReserve.totalSupplyAPY(currentSlot) * 100
  ).toFixed(2);

  if (!debtMint) {
    return {
      collateralReserveAddress: collateralReserve.address.toString(),
      marketAddress,
      stats: {
        ltv: collateralReserve.stats.loanToValue,
        liquidationThreshold: collateralReserve.stats.liquidationThreshold,
        supplyApy,
      },
    };
  }

  const debtReserve = reservesArray.find(
    (r) =>
      r.getLiquidityMint().toString() === debtMint &&
      r.stats.status === ReserveStatus.Active &&
      !r.stats.reserveBorrowLimit.isZero(),
  );

  if (!debtReserve) return null;

  const borrowApy = (debtReserve.totalBorrowAPY(currentSlot) * 100).toFixed(2);

  return {
    collateralReserveAddress: collateralReserve.address.toString(),
    debtReserveAddress: debtReserve.address.toString(),
    marketAddress,
    stats: {
      ltv: collateralReserve.stats.loanToValue,
      liquidationThreshold: collateralReserve.stats.liquidationThreshold,
      supplyApy,
      borrowApy,
    },
  };
}
