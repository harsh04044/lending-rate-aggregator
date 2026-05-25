/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  DriftClient,
  Wallet,
  User,
  calculateDepositRate,
  calculateBorrowRate,
  convertToNumber,
  PERCENTAGE_PRECISION,
  PRICE_PRECISION,
  DRIFT_PROGRAM_ID,
  getUserAccountPublicKey,
  type SpotMarketAccount,
  SpotMarkets,
} from "@drift-labs/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Asset, NormalizedPosition, Protocol } from "../types/main";
import { HeliusTransaction } from "./helius";
import {
  ActionType,
  DRIFT_DISCRIMINATORS,
  DRIFT_USER_ACCOUNT_INDEX,
  HistoryEntry,
} from "../lib/discriminators";
import { getTokenInfo, getTokenLogo } from "../lib/token-registry";
import { rawToDecimal } from ".";
import { computeWeightedRisk } from "./main";
import bs58 from "bs58";
import { MarketPairStats } from "../types";

let _driftClientPromise: Promise<DriftClient> | null = null;

export function getSharedDriftClient(): Promise<DriftClient> {
  if (_driftClientPromise) return _driftClientPromise;

  _driftClientPromise = (async () => {
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) throw new Error("RPC_URL not configured");

    const connection = new Connection(rpcUrl, "confirmed");
    const dummyKeypair = Keypair.generate();
    const wallet = new Wallet(dummyKeypair as any);

    const client = new DriftClient({
      connection: connection as any,
      wallet,
      env: "mainnet-beta",
      accountSubscription: {
        type: "websocket",
        resubTimeoutMs: 30000,
        logResubMessages: false,
      },
    });

    await client.subscribe();
    return client;
  })().catch((err) => {
    _driftClientPromise = null;
    throw err;
  });

  return _driftClientPromise;
}

function computeDriftHealthPct(
  collateralAssets: { amountUsd: number; maintenanceWeight: number }[],
  debtAssets: { amountUsd: number; maintenanceWeight: number }[],
): number {
  // Drift health = weighted collateral / weighted debt
  // maintenanceAssetWeight for collateral (e.g. 0.9 = 90% counts)
  // maintenanceLiabilityWeight for debt (e.g. 1.1 = 110% counts)
  // Liquidation when weighted collateral <= weighted debt

  const weightedCollateral = collateralAssets.reduce(
    (sum, a) => sum + a.amountUsd * a.maintenanceWeight,
    0,
  );

  const weightedDebt = debtAssets.reduce(
    (sum, a) => sum + a.amountUsd * a.maintenanceWeight,
    0,
  );

  if (weightedDebt <= 0) return 100;
  if (weightedCollateral <= 0) return 0;

  // ratio > 1 = healthy, ratio = 1 = liquidation
  const ratio = weightedCollateral / weightedDebt;

  if (ratio <= 1) return 0;

  // Convert to 0-100 scale
  // ratio of 2 = very safe, ratio of 1.05 = barely alive
  // Cap at 100 for very safe positions
  return Math.min(((ratio - 1) / ratio) * 100, 100);
}

export async function fetchDriftPositions(
  wallet: string,
): Promise<NormalizedPosition[]> {
  if (!wallet) return [];

  const driftClient = await getSharedDriftClient();

  const walletPublicKey = new PublicKey(wallet);
    const userAccountPubkey = await getUserAccountPublicKey(
      new PublicKey(DRIFT_PROGRAM_ID),
      walletPublicKey,
      0, // subaccount 0
    );

    const user = new User({
      driftClient,
      userAccountPublicKey: userAccountPubkey,
    });

    const exists = await user.exists();
    if (!exists) return [];

    await user.subscribe();

    try {
      const userAccount = user.getUserAccount();
      const spotPositions = userAccount.spotPositions;

      // Prefetch all logos in parallel from Jupiter token registry (cached, cheap)
      const activeMints = spotPositions
        .filter((p) => !p.scaledBalance.isZero())
        .map((p) => {
          const market = driftClient.getSpotMarketAccount(p.marketIndex);
          return market?.mint.toBase58() ?? null;
        })
        .filter((m): m is string => m !== null);

      const logoEntries = await Promise.all(
        activeMints.map(async (mint) => [mint, await getTokenLogo(mint)] as const),
      );
      const logoMap = new Map(logoEntries);

      const collateralAssets: Asset[] = [];
      const debtAssets: Asset[] = [];

      // For health computation
      const collateralHealthData: {
        amountUsd: number;
        maintenanceWeight: number;
      }[] = [];
      const debtHealthData: {
        amountUsd: number;
        maintenanceWeight: number;
      }[] = [];

      let totalCollateralUsd = 0;
      let totalDebtUsd = 0;

      for (const spotPosition of spotPositions) {
        // Skip empty slots
        if (spotPosition.scaledBalance.isZero()) continue;

        const marketIndex = spotPosition.marketIndex;
        const market: SpotMarketAccount | undefined =
          driftClient.getSpotMarketAccount(marketIndex);

        if (!market) continue;

        const tokenAmount = user.getTokenAmount(marketIndex);

        // Skip zero balances
        if (tokenAmount.isZero()) continue;

        const oracleData = driftClient.getOracleDataForSpotMarket(marketIndex);
        const price = convertToNumber(oracleData.price, PRICE_PRECISION);
        const decimals = market.decimals;
        const mint = market.mint.toBase58();

        const amountHuman = rawToDecimal(tokenAmount.abs().toString(), decimals);
        const amountUsd = amountHuman * price;

        // Skip dust (< $0.01)
        if (amountUsd < 0.01) continue;

        const logoUrl = logoMap.get(mint) ?? "";

        // Find symbol from SpotMarkets config
        const symbol = Buffer.from(market.name)
          .toString("utf-8")
          .replace(/\0/g, "")
          .trim();

        if (tokenAmount.isNeg()) {
          // Negative = borrow
          const borrowRate = calculateBorrowRate(market);
          const borrowApy =
            convertToNumber(borrowRate, PERCENTAGE_PRECISION) * 100;

          const maintenanceWeight = market.maintenanceLiabilityWeight / 10_000;

          debtAssets.push({
            mint,
            symbol,
            name: symbol,
            decimals,
            logoUrl,
            amount: amountHuman.toString(),
            amountUsd,
            price,
            borrowApy,
          });

          debtHealthData.push({ amountUsd, maintenanceWeight });
          totalDebtUsd += amountUsd;
        } else {
          // Positive = deposit
          const depositRate = calculateDepositRate(market);
          const supplyApy =
            convertToNumber(depositRate, PERCENTAGE_PRECISION) * 100;

          const maintenanceWeight = market.maintenanceAssetWeight / 10_000;
          // Drift weights are stored in 10_000 base (e.g. 9000 = 0.9 = 90%).
          // Use initialAssetWeight as maxLTV (open cap) and
          // maintenanceAssetWeight as liqThreshold (liquidation cap).
          const assetMaxLTV = market.initialAssetWeight / 100;
          const assetLiqThreshold = market.maintenanceAssetWeight / 100;

          collateralAssets.push({
            mint,
            symbol,
            name: symbol,
            decimals,
            logoUrl,
            amount: amountHuman.toString(),
            amountUsd,
            price,
            supplyApy,
            maxLTV: assetMaxLTV,
            liqThreshold: assetLiqThreshold,
          });

          collateralHealthData.push({ amountUsd, maintenanceWeight });
          totalCollateralUsd += amountUsd;
        }
      }

      // Nothing on this subaccount
      if (collateralAssets.length === 0 && debtAssets.length === 0) {
        return [];
      }

      const healthPct = computeDriftHealthPct(
        collateralHealthData,
        debtHealthData,
      );

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
        equity > 0
          ? ((supplyEarnings - borrowCosts) / equity) * 100
          : 0;

      return [
        {
          protocol: Protocol.Drift,
          label: "Drift",
          accountAddress: userAccountPubkey.toBase58(),
          collateral: collateralAssets,
          debt: debtAssets,
          totalCollateralUsd,
          totalDebtUsd,
          healthPct,
          netApy,
          risk: computeWeightedRisk(collateralAssets),
          meta: {
            subaccountId: 0,
          },
        },
      ];
    } finally {
      await user.unsubscribe();
    }
}

// History

interface DriftInstruction {
  rawActionType: "deposit" | "withdraw";
  accounts: string[];
}

function findDriftActions(tx: HeliusTransaction): DriftInstruction[] {
  const actions: DriftInstruction[] = [];

  function check(ix: { programId: string; data: string; accounts: string[] }) {
    if (ix.programId !== DRIFT_PROGRAM_ID || !ix.data) return;

    try {
      const dataBuffer = Buffer.from(bs58.decode(ix.data));
      if (dataBuffer.length < 8) return;

      const disc = dataBuffer.subarray(0, 8).toString("hex");

      if (disc === DRIFT_DISCRIMINATORS.deposit) {
        actions.push({ rawActionType: "deposit", accounts: ix.accounts });
      } else if (disc === DRIFT_DISCRIMINATORS.withdraw) {
        actions.push({ rawActionType: "withdraw", accounts: ix.accounts });
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

/**
 * Classify Drift actions based on:
 * 1. Raw instruction type (deposit/withdraw)
 * 2. User's current position state for that token (debtMints/collateralMints)
 *
 * Logic:
 * - deposit instruction: if user has debt in this token → "repay", else → "deposit"
 * - withdraw instruction: if user has collateral in this token → "withdraw", else → "borrow"
 *
 * This uses CURRENT position state as a proxy for historical state, which is an
 * approximation. For most MVP cases this is correct because:
 * - User wouldn't deposit if they didn't have debt (would withdraw instead)
 * - User wouldn't withdraw if they didn't have collateral (would borrow instead)
 *
 * Edge case: if user fully repaid debt AND fully withdrew collateral since the tx,
 * classification may be wrong. Acceptable for MVP.
 */

// TODO: Drift action classification currently uses current position state
// (debtMints / collateralMints) as a proxy for historical state.
// This can misclassify actions when positions are fully closed or changed over time.
// Future improvement: reconstruct position state per transaction (chronological replay)
// for accurate classification.
export async function processDriftTransaction(
  tx: HeliusTransaction,
  wallet: string,
  debtMints: Set<string>,
  collateralMints: Set<string>,
): Promise<HistoryEntry[]> {
  const actions = findDriftActions(tx);
  if (actions.length === 0) return [];

  const entries: HistoryEntry[] = [];
  // Consume transfers to prevent two same-direction actions from matching the same one
  const availableTransfers = [...tx.tokenTransfers];

  for (const action of actions) {
    const userAccount = action.accounts[DRIFT_USER_ACCOUNT_INDEX] ?? "";

    const userIsSending = action.rawActionType === "deposit";
    // accounts[5] = userTokenAccount (the user's ATA for this market).
    // Matching by token account avoids picking up flash loan transfers that also
    // go to/from the wallet but belong to a different program.
    const userTokenAccount = action.accounts[5] ?? "";

    let transferIdx = availableTransfers.findIndex((t) => {
      if (t.tokenAmount === 0) return false;
      return userIsSending
        ? t.fromTokenAccount === userTokenAccount
        : t.toTokenAccount === userTokenAccount;
    });
    // Fall back to wallet-direction matching if token account index is absent
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

    // Classify based on current position state
    let actionType: ActionType;
    if (action.rawActionType === "deposit") {
      actionType = debtMints.has(transfer.mint) ? "repay" : "deposit";
    } else {
      actionType = collateralMints.has(transfer.mint) ? "withdraw" : "borrow";
    }

    const tokenInfo = await getTokenInfo(transfer.mint);
    const tokenSymbol = tokenInfo?.symbol ?? transfer.mint.slice(0, 6);

    entries.push({
      timestamp: tx.timestamp,
      actionType,
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
      accountAddress: userAccount,
    });
  }

  return entries;
}

const MARGIN_PRECISION = 10_000;
const spotMarkets = SpotMarkets["mainnet-beta"];

export interface DriftMarketPair {
  collateralMarketIndex: number;
  debtMarketIndex?: number;
  poolId: number;
  stats: MarketPairStats;
}

export async function findDriftMarketPair(
  collateralMint: string,
  debtMint?: string,
): Promise<DriftMarketPair | null> {
  const driftClient = await getSharedDriftClient();

  const collateralEntries = spotMarkets.filter(
    (m) => m.mint.toBase58() === collateralMint && m.poolId === 0,
  );

  if (collateralEntries.length === 0) return null;

  if (!debtMint) {
    const colEntry = collateralEntries[0];
    const colMarket = driftClient.getSpotMarketAccount(colEntry.marketIndex);
    if (!colMarket) return null;

    const supplyApy = (
      convertToNumber(calculateDepositRate(colMarket), PERCENTAGE_PRECISION) * 100
    ).toFixed(2);

    return {
      collateralMarketIndex: colEntry.marketIndex,
      poolId: colEntry.poolId,
      stats: {
        ltv: colMarket.initialAssetWeight / MARGIN_PRECISION,
        liquidationThreshold: colMarket.maintenanceAssetWeight / MARGIN_PRECISION,
        supplyApy,
      },
    };
  }

  const debtEntries = spotMarkets.filter(
    (m) => m.mint.toBase58() === debtMint && m.poolId === 0,
  );

  if (debtEntries.length === 0) return null;

  let bestPair: DriftMarketPair | null = null;
  let bestLtv = 0;

  for (const colEntry of collateralEntries) {
    for (const debtEntry of debtEntries) {
      if (colEntry.marketIndex === debtEntry.marketIndex) continue;

      const colMarket: SpotMarketAccount | undefined =
        driftClient.getSpotMarketAccount(colEntry.marketIndex);
      const debtMarket: SpotMarketAccount | undefined =
        driftClient.getSpotMarketAccount(debtEntry.marketIndex);

      if (!colMarket || !debtMarket) continue;

      const ltv = colMarket.initialAssetWeight / MARGIN_PRECISION;
      const liquidationThreshold =
        colMarket.maintenanceAssetWeight / MARGIN_PRECISION;

      if (ltv === 0) continue;

      const supplyApy = (
        convertToNumber(calculateDepositRate(colMarket), PERCENTAGE_PRECISION) * 100
      ).toFixed(2);
      const borrowApy = (
        convertToNumber(calculateBorrowRate(debtMarket), PERCENTAGE_PRECISION) * 100
      ).toFixed(2);

      const pair: DriftMarketPair = {
        collateralMarketIndex: colEntry.marketIndex,
        debtMarketIndex: debtEntry.marketIndex,
        poolId: colEntry.poolId,
        stats: { ltv, liquidationThreshold, supplyApy, borrowApy },
      };

      if (ltv > bestLtv) {
        bestLtv = ltv;
        bestPair = pair;
      }
    }
  }

  return bestPair;
}
