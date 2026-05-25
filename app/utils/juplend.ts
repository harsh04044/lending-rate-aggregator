/* eslint-disable @typescript-eslint/no-explicit-any */

import { rawToDecimal } from ".";
import {
  ActionType,
  HistoryEntry,
  JUPLEND_OPERATE_DISC,
  JUPLEND_VAULTS_PROGRAM,
} from "../lib/discriminators";
import { getTokenLogo } from "../lib/token-registry";
import { MarketPairStats } from "../types";
import { Asset, NormalizedPosition, Protocol } from "../types/main";
import { HeliusTransaction } from "./helius";
import bs58 from "bs58";

const JUPLEND_API = "https://api.solana.fluid.io/v1/borrowing";

// JupLend Vault Config
const JUPLEND_VAULTS_API = "https://api.solana.fluid.io/v1/borrowing/vaults";

interface JupLendVaultToken {
  address: string;
  symbol: string;
  uiSymbol?: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
  price: string;
}

interface JupLendPosition {
  id: number;
  vaultId: number;
  address: string;
  supply: string; // raw amount
  borrow: string; // raw amount
  isLiquidated: boolean;
  vault: {
    supplyToken: JupLendVaultToken;
    borrowToken: JupLendVaultToken;
    collateralFactor: number; // e.g. 750 → 0.75
    liquidationThreshold: number; // e.g. 800 → 0.80
    supplyRate: number; // e.g. 519 → 5.19%
    borrowRate: number; // e.g. 388 → 3.88%
  };
}

// How far from liquidation as 0-100
// 0 = at liquidation, 100 = no debt
// We should let users know what our health percentage actually is in tooltip!
function computeHealthPct(
  collateralUsd: number,
  debtUsd: number,
  liquidationThreshold: number,
): number {
  // No debt = fully healthy
  if (debtUsd <= 0) return 100;

  // Debt with no collateral = at/past liquidation
  if (collateralUsd <= 0) return 0;

  const currentLtv = debtUsd / collateralUsd;

  // Already past liquidation
  if (currentLtv >= liquidationThreshold) return 0;

  return ((liquidationThreshold - currentLtv) / liquidationThreshold) * 100;
}

export async function fetchJupLendPositions(
  wallet: string,
): Promise<NormalizedPosition[]> {
  if (!wallet) return [];

  const data: JupLendPosition[] = await fetch(
    `${JUPLEND_API}/users/${wallet}/nfts`,
  ).then((res) => {
    if (!res.ok) throw new Error(`JupLend API error: ${res.status}`);
    return res.json();
  });

  const positions: NormalizedPosition[] = [];

  for (const pos of data) {
    if (pos.isLiquidated) continue;

    const supplyToken = pos.vault.supplyToken;
    const borrowToken = pos.vault.borrowToken;

    const collateralPrice = parseFloat(supplyToken.price);
    const debtPrice = parseFloat(borrowToken.price);

    const collateralAmount = rawToDecimal(pos.supply, supplyToken.decimals);
    const debtAmount = rawToDecimal(pos.borrow, borrowToken.decimals);

    const collateralUsd = collateralAmount * collateralPrice;
    const debtUsd = debtAmount * debtPrice;

    // Empty (supply=0, borrow=0) slots are KEPT here. They're valid reuse
    // targets for the refinance picker (pickJupLendPositionId), but we skip these for ui layer (we filter them)

    const supplyApy = pos.vault.supplyRate / 100; // 519 → 5.19
    const borrowApy = pos.vault.borrowRate / 100; // 388 → 3.88
    const liquidationThreshold = pos.vault.liquidationThreshold / 1000; // 800 → 0.80
    // collateralFactor / liquidationThreshold are stored as bps-ish values
    // (e.g. 750, 800). Express as percentages (75, 80) for the Asset shape.
    const assetMaxLTV = pos.vault.collateralFactor / 10;
    const assetLiqThreshold = pos.vault.liquidationThreshold / 10;

    const collateral: Asset = {
      mint: supplyToken.address,
      symbol: supplyToken.uiSymbol ?? supplyToken.symbol,
      name: supplyToken.name,
      decimals: supplyToken.decimals,
      logoUrl: supplyToken.logoUrl ?? "",
      amount: collateralAmount.toString(),
      amountUsd: collateralUsd,
      price: collateralPrice,
      supplyApy,
      maxLTV: assetMaxLTV,
      liqThreshold: assetLiqThreshold,
    };

    const debt: Asset = {
      mint: borrowToken.address,
      symbol: borrowToken.uiSymbol ?? borrowToken.symbol,
      name: borrowToken.name,
      decimals: borrowToken.decimals,
      logoUrl: borrowToken.logoUrl ?? "",
      amount: debtAmount.toString(),
      amountUsd: debtUsd,
      price: debtPrice,
      borrowApy,
    };

    const healthPct = computeHealthPct(
      collateralUsd,
      debtUsd,
      liquidationThreshold,
    );

    // Net APY relative to equity (collateral - debt) to reflect leveraged returns
    const supplyEarnings = (collateralUsd * supplyApy) / 100;
    const borrowCosts = (debtUsd * borrowApy) / 100;
    const equity = collateralUsd - debtUsd;
    const netApy =
      equity > 0 ? ((supplyEarnings - borrowCosts) / equity) * 100 : 0;

    positions.push({
      protocol: Protocol.JupLend,
      label: "JupLend",
      accountAddress: pos.address,
      collateral: [collateral],
      debt: debtUsd > 0.01 ? [debt] : [],
      totalCollateralUsd: collateralUsd,
      totalDebtUsd: debtUsd,
      healthPct,
      netApy,
      risk:
        collateralUsd > 0
          ? { maxLTV: assetMaxLTV, liqThreshold: assetLiqThreshold }
          : null,
      meta: {
        positionId: pos.id,
        vaultId: pos.vaultId,
        collateralFactor: pos.vault.collateralFactor / 1000,
        liquidationThreshold,
      },
    });
  }

  return positions;
}

interface VaultPair {
  supplyMint: string;
  supplySymbol: string;
  borrowMint: string;
  borrowSymbol: string;
}

let cachedVaultPairs: VaultPair[] | null = null;

export async function getVaultPairs(): Promise<VaultPair[]> {
  if (cachedVaultPairs) return cachedVaultPairs;

  const vaults = await fetch(JUPLEND_VAULTS_API).then((res) => {
    if (!res.ok) throw new Error(`JupLend vaults API error: ${res.status}`);
    return res.json();
  });

  cachedVaultPairs = vaults.map((v: any) => ({
    supplyMint: v.supplyToken.address,
    supplySymbol: v.supplyToken.symbol,
    borrowMint: v.borrowToken.address,
    borrowSymbol: v.borrowToken.symbol,
  }));

  return cachedVaultPairs!;
}

function findOperateInstruction(
  tx: HeliusTransaction,
): { programId: string; accounts: string[]; data: string } | null {
  for (const ix of tx.instructions) {
    if (ix.programId === JUPLEND_VAULTS_PROGRAM && ix.data) {
      try {
        const dataBuffer = Buffer.from(bs58.decode(ix.data));
        if (
          dataBuffer.length >= 8 &&
          dataBuffer.subarray(0, 8).toString("hex") === JUPLEND_OPERATE_DISC
        ) {
          return ix;
        }
      } catch {}
    }

    // Check inner instructions
    if (ix.innerInstructions) {
      for (const inner of ix.innerInstructions) {
        if (inner.programId === JUPLEND_VAULTS_PROGRAM && inner.data) {
          try {
            const dataBuffer = Buffer.from(bs58.decode(inner.data));
            if (
              dataBuffer.length >= 8 &&
              dataBuffer.subarray(0, 8).toString("hex") === JUPLEND_OPERATE_DISC
            ) {
              return inner;
            }
          } catch {}
        }
      }
    }
  }
  return null;
}

function findVaultFromInstruction(
  operateIx: { accounts: string[] },
  vaultPairs: VaultPair[],
): VaultPair | null {
  // From the IDL, operate instruction accounts:
  // [8] = supply_token (mint), [9] = borrow_token (mint)
  // Optional accounts (3,4,5) use program ID as placeholder, so indices stay stable
  if (!operateIx.accounts || operateIx.accounts.length < 10) return null;

  const supplyMint = operateIx.accounts[8];
  const borrowMint = operateIx.accounts[9];

  return (
    vaultPairs.find(
      (v) => v.supplyMint === supplyMint && v.borrowMint === borrowMint,
    ) ?? null
  );
}

// This is a fallback
function findVaultFromTransfers(
  tx: HeliusTransaction,
  wallet: string,
  vaultPairs: VaultPair[],
): VaultPair | null {
  // Fallback: collect all mints from user-involved transfers, match against vault pairs
  const mints = new Set<string>();
  for (const t of tx.tokenTransfers) {
    if (t.fromUserAccount === wallet || t.toUserAccount === wallet) {
      mints.add(t.mint);
    }
  }

  for (const vault of vaultPairs) {
    if (mints.has(vault.supplyMint) && mints.has(vault.borrowMint)) {
      return vault;
    }
  }

  return null;
}

export async function processJupLendTransaction(
  tx: HeliusTransaction,
  vaultPairs: VaultPair[],
  wallet: string,
): Promise<HistoryEntry[]> {
  const operateIx = findOperateInstruction(tx);
  if (!operateIx) return [];

  // Find the vault pair, try instruction accounts first, fallback to dual-mint transfer match
  const vault =
    findVaultFromInstruction(operateIx, vaultPairs) ??
    findVaultFromTransfers(tx, wallet, vaultPairs);

  if (!vault) return [];

  const entries: HistoryEntry[] = [];

  for (const transfer of tx.tokenTransfers) {
    if (transfer.tokenAmount === 0) continue;

    const isFromUser = transfer.fromUserAccount === wallet;
    const isToUser = transfer.toUserAccount === wallet;

    if (!isFromUser && !isToUser) continue;

    let actionType: ActionType | null = null;
    let tokenSymbol = "";

    if (transfer.mint === vault.supplyMint) {
      actionType = isFromUser ? "deposit" : "withdraw";
      tokenSymbol = vault.supplySymbol;
    } else if (transfer.mint === vault.borrowMint) {
      actionType = isFromUser ? "repay" : "borrow";
      tokenSymbol = vault.borrowSymbol;
    } else {
      // Unknown mint (e.g., NFT mint) — skip
      continue;
    }

    entries.push({
      timestamp: tx.timestamp,
      actionType,
      tokens: [
        {
          tokenSymbol,
          tokenAmount: Math.abs(transfer.tokenAmount).toString(),
          tokenMint: transfer.mint,
          logoUrl: await getTokenLogo(transfer.mint),
          // TODO: backfill with the price at tx.timestamp once we have a
          // historical price source; 0 for now so the UI doesn't render USD.
          tokenPrice: 0,
        },
      ],
      signature: tx.signature,
      accountAddress: operateIx.accounts?.[11] ?? "", // position account from IDL
    });
  }

  return entries;
}

export interface JupiterMarketPair {
  vaultId: number;
  vaultAddress: string;
  stats: MarketPairStats;
}

interface JupiterVault {
  id: number;
  address: string;
  supplyToken: {
    address: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
    price: string;
  };
  borrowToken: {
    address: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
    price: string;
  };
  collateralFactor: number;
  liquidationThreshold: number;
  supplyRate: number;
  borrowRate: number;
}

// TODO: Replace with Redis or a shared cache when moving to multi-instance deployments.
const JUP_VAULTS_TTL_MS = 10 * 60 * 1000; // 10 minutes
let cachedJupVaults: JupiterVault[] | null = null;
let cachedJupVaultsAt = 0;

async function fetchJupiterVaults(): Promise<JupiterVault[]> {
  if (cachedJupVaults && Date.now() - cachedJupVaultsAt < JUP_VAULTS_TTL_MS) {
    return cachedJupVaults;
  }
  const res = await fetch("https://api.solana.fluid.io/v1/borrowing/vaults");
  if (!res.ok) throw new Error(`JupLend vaults API error: ${res.status}`);
  cachedJupVaults = await res.json();
  cachedJupVaultsAt = Date.now();
  return cachedJupVaults!;
}

export async function fetchJupiterMarket(
  collateralMint: string,
  debtMint?: string,
): Promise<JupiterMarketPair | null> {
  if (!collateralMint) return null;

  const vaults = await fetchJupiterVaults();

  if (!debtMint) {
    // Supply-only: find the vault with the best supply rate for this collateral
    const vault = vaults
      .filter((v) => v.supplyToken.address === collateralMint)
      .sort((a, b) => b.supplyRate - a.supplyRate)[0];

    if (!vault) return null;

    return {
      vaultId: vault.id,
      vaultAddress: vault.address,
      stats: {
        ltv: vault.collateralFactor / 1000,
        liquidationThreshold: vault.liquidationThreshold / 1000,
        supplyApy: (vault.supplyRate / 100).toFixed(2),
      },
    };
  }

  const vault = vaults.find(
    (v) =>
      v.supplyToken.address === collateralMint &&
      v.borrowToken.address === debtMint,
  );

  if (!vault) return null;

  return {
    vaultId: vault.id,
    vaultAddress: vault.address,
    stats: {
      ltv: vault.collateralFactor / 1000,
      liquidationThreshold: vault.liquidationThreshold / 1000,
      supplyApy: (vault.supplyRate / 100).toFixed(2),
      borrowApy: (vault.borrowRate / 100).toFixed(2),
    },
  };
}
