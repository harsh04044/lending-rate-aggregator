/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  SpotMarkets,
  calculateBorrowRate,
  convertToNumber,
  PERCENTAGE_PRECISION,
} from "@drift-labs/sdk";
import { address as createAddress } from "@solana/kit";
import { Connection, PublicKey } from "@solana/web3.js";
import { Protocol } from "@/app/types/main";
import { parseReserve, formatReserve } from "@/app/lib/solend-sdk/reserve";
import { getSharedDriftClient } from "./drift";
import { getRpc, getOrLoadMarket } from "./kamino";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BorrowRate {
  protocol: Protocol;
  borrowApr: number;
  collateralMint?: string;
  vaultId?: number;
}

// ─── JupLend ─────────────────────────────────────────────────────────────────

const JUPLEND_VAULTS_API = "https://api.solana.fluid.io/v1/borrowing/vaults";

let cachedVaults: any[] | null = null;
let cachedVaultsTimestamp = 0;
const VAULTS_CACHE_TTL = 1000 * 60 * 10; // 10 minutes

async function getJupLendVaults(): Promise<any[]> {
  const now = Date.now();
  if (cachedVaults && now - cachedVaultsTimestamp < VAULTS_CACHE_TTL) {
    return cachedVaults;
  }

  cachedVaults = await fetch(JUPLEND_VAULTS_API).then((res) => {
    if (!res.ok) throw new Error(`JupLend vaults API error: ${res.status}`);
    return res.json();
  });
  cachedVaultsTimestamp = now;
  return cachedVaults!;
}

async function getJupLendBorrowRate(
  debtMint: string,
  collateralMint?: string,
): Promise<BorrowRate | null> {
  if (!collateralMint) return null;

  const vaults = await getJupLendVaults();

  const vault = vaults.find(
    (v: any) =>
      v.borrowToken.address === debtMint &&
      v.supplyToken.address === collateralMint,
  );

  if (!vault) return null;

  return {
    protocol: Protocol.JupLend,
    borrowApr: vault.borrowRate / 100,
    collateralMint,
    vaultId: vault.id,
  };
}

// ─── Drift ───────────────────────────────────────────────────────────────────

const spotMarkets = SpotMarkets["mainnet-beta"];

async function getDriftBorrowRate(
  debtMint: string,
): Promise<BorrowRate | null> {
  const marketConfig = spotMarkets.find(
    (m) => m.mint.toBase58() === debtMint && m.poolId === 0,
  );
  if (!marketConfig) return null;

  const driftClient = await getSharedDriftClient();
  const market = driftClient.getSpotMarketAccount(marketConfig.marketIndex);
  if (!market) return null;

  const rate = calculateBorrowRate(market);
  const borrowApr = convertToNumber(rate, PERCENTAGE_PRECISION) * 100;

  return { protocol: Protocol.Drift, borrowApr };
}

// ─── Save ────────────────────────────────────────────────────────────────────

const SAVE_API_URL = "https://api.save.finance/v1/markets/configs";

let cachedSaveConfigs: any[] | null = null;
let cachedSaveTimestamp = 0;
const SAVE_CACHE_TTL = 1000 * 60 * 10; // 10 minutes

async function getSaveMarketConfigs(): Promise<any[]> {
  const now = Date.now();
  if (cachedSaveConfigs && now - cachedSaveTimestamp < SAVE_CACHE_TTL) {
    return cachedSaveConfigs;
  }

  cachedSaveConfigs = await fetch(SAVE_API_URL).then((res) => {
    if (!res.ok) throw new Error(`Save API error: ${res.status}`);
    return res.json();
  });
  cachedSaveTimestamp = now;
  return cachedSaveConfigs!;
}

async function getSaveBorrowRate(debtMint: string): Promise<BorrowRate | null> {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) return null;

  const pools = await getSaveMarketConfigs();
  const connection = new Connection(rpcUrl, "confirmed");

  for (const pool of pools) {
    if (pool.isPermissionless || pool.hidden) continue;

    const reserveConfig = pool.reserves.find(
      (r: any) => r.liquidityToken.mint === debtMint,
    );
    if (!reserveConfig) continue;

    const accountInfo = await connection.getAccountInfo(
      new PublicKey(reserveConfig.address),
    );
    if (!accountInfo) continue;

    const parsed = parseReserve(
      new PublicKey(reserveConfig.address),
      accountInfo,
    );
    if (!parsed) continue;

    const formatted = formatReserve(parsed);
    const borrowApr = formatted.borrowInterest.times(100).toNumber();

    return { protocol: Protocol.Save, borrowApr };
  }

  return null;
}

// ─── Kamino ──────────────────────────────────────────────────────────────────

const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const KAMINO_JLP_MARKET = "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek";

async function getKaminoBorrowRate(
  debtMint: string,
): Promise<BorrowRate | null> {
  const rpc = getRpc();
  const currentSlot = await rpc.getSlot().send();

  const marketAddresses = [KAMINO_MAIN_MARKET, KAMINO_JLP_MARKET];

  for (const addr of marketAddresses) {
    const market = await getOrLoadMarket(addr);
    if (!market) continue;

    const reserve = market.getReserveByMint(createAddress(debtMint));
    if (!reserve) continue;

    const borrowApr = reserve.totalBorrowAPY(BigInt(currentSlot)) * 100;

    return { protocol: Protocol.Kamino, borrowApr };
  }

  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

// In borrow-rates.ts, change the signature:
export async function fetchBorrowRates(
  debtMint: string,
  collateralMints: string[],
): Promise<BorrowRate[]> {
  const jupLendPromises = collateralMints.map((colMint) =>
    getJupLendBorrowRate(debtMint, colMint),
  );

  const results = await Promise.allSettled([
    ...jupLendPromises,
    getDriftBorrowRate(debtMint),
    getSaveBorrowRate(debtMint),
    getKaminoBorrowRate(debtMint),
  ]);

  const rates: BorrowRate[] = [];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      rates.push(result.value);
    }
  }

  return rates;
}
