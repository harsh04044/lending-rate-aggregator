import {
  Asset,
  ProtocolDistribution,
  NormalizedPosition,
  HealthCardValues,
  Protocol,
  RiskParams,
} from "@/app/types/main";
import { fetchBorrowRates } from "./borrow-rates";

const MIN_SAVINGS_THRESHOLD = 5; // $5/mo

/**
 * USD-weighted average of `maxLTV` and `liqThreshold` across the supplied
 * collateral assets. Returns null if no asset carries risk params or if
 * total weighted USD is zero.
 */
export function computeWeightedRisk(collaterals: Asset[]): RiskParams | null {
  let weightedMaxLTV = 0;
  let weightedLiqThreshold = 0;
  let totalUsd = 0;

  for (const asset of collaterals) {
    if (asset.maxLTV == null || asset.liqThreshold == null) continue;
    if (asset.amountUsd <= 0) continue;
    weightedMaxLTV += asset.amountUsd * asset.maxLTV;
    weightedLiqThreshold += asset.amountUsd * asset.liqThreshold;
    totalUsd += asset.amountUsd;
  }

  if (totalUsd <= 0) return null;
  return {
    maxLTV: weightedMaxLTV / totalUsd,
    liqThreshold: weightedLiqThreshold / totalUsd,
  };
}

/**
 * Same weighted average, but rolled up across every collateral asset on
 * every position in the provided list.
 */
export function computeProtocolRisk(
  positions: NormalizedPosition[],
): RiskParams | null {
  return computeWeightedRisk(positions.flatMap((p) => p.collateral));
}

export async function computeSavingsPerProtocol(
  positions: NormalizedPosition[],
): Promise<Map<Protocol, number>> {
  const debtContexts = positions.flatMap((pos) => {
    const collateralMints = pos.collateral.map((c) => c.mint);
    return pos.debt
      .filter((asset) => asset.borrowApy !== undefined && asset.amountUsd >= 1)
      .map((asset) => ({ protocol: pos.protocol, asset, collateralMints }));
  });

  if (debtContexts.length === 0) return new Map();

  const rateResults = await Promise.allSettled(
    debtContexts.map((ctx) => fetchBorrowRates(ctx.asset.mint, ctx.collateralMints)),
  );

  const savingsMap = new Map<Protocol, number>();

  for (let i = 0; i < debtContexts.length; i++) {
    const { protocol, asset } = debtContexts[i];
    const result = rateResults[i];
    if (result.status !== "fulfilled") continue;

    const alternatives = result.value.filter((r) => r.protocol !== protocol);
    if (alternatives.length === 0) continue;

    const best = alternatives.reduce((a, b) => (a.borrowApr < b.borrowApr ? a : b));
    if (best.borrowApr >= asset.borrowApy!) continue;

    const monthly = (asset.amountUsd * (asset.borrowApy! - best.borrowApr)) / 100 / 12;
    if (monthly < MIN_SAVINGS_THRESHOLD) continue;

    savingsMap.set(protocol, (savingsMap.get(protocol) ?? 0) + monthly);
  }

  return savingsMap;
}

export function computeHealthCard(
  positions: NormalizedPosition[],
): HealthCardValues {
  // 1. Net worth
  const totalCollateral = positions.reduce(
    (sum, p) => sum + p.totalCollateralUsd,
    0,
  );
  const totalDebt = positions.reduce((sum, p) => sum + p.totalDebtUsd, 0);
  const netWorth = totalCollateral - totalDebt;

  // 2. Daily P&L from rates
  // Drift is excluded until its rate feed stabilizes — pools have been spiking
  // to 100%+ APR and dominate the headline number.
  let dailyEarnings = 0;
  let dailyCosts = 0;

  for (const pos of positions) {
    if (pos.protocol === Protocol.Drift) continue;
    for (const asset of pos.collateral) {
      if (asset.supplyApy) {
        dailyEarnings += (asset.amountUsd * asset.supplyApy) / 365 / 100;
      }
    }
    for (const asset of pos.debt) {
      if (asset.borrowApy) {
        dailyCosts += (asset.amountUsd * asset.borrowApy) / 365 / 100;
      }
    }
  }

  const dailyPnl = dailyEarnings - dailyCosts;

  // 3. Health: debt-weighted average
  let weightedHealthSum = 0;
  let totalDebtWeight = 0;
  let atRiskPositions = 0;

  for (const pos of positions) {
    if (pos.totalDebtUsd > 0) {
      weightedHealthSum += pos.healthPct * pos.totalDebtUsd;
      totalDebtWeight += pos.totalDebtUsd;
    }
    if (pos.healthPct < 15) {
      atRiskPositions++;
    }
  }

  const healthPct =
    totalDebtWeight > 0 ? weightedHealthSum / totalDebtWeight : 100;

  // 4. Distribution by protocol
  const protocolTotals = new Map<
    Protocol,
    { collateralUsd: number; dailyPnl: number; atRiskPositions: number }
  >();

  for (const pos of positions) {
    const entry = protocolTotals.get(pos.protocol) ?? {
      collateralUsd: 0,
      dailyPnl: 0,
      atRiskPositions: 0,
    };

    let posDailyEarnings = 0;
    let posDailyCosts = 0;
    if (pos.protocol !== Protocol.Drift) {
      for (const asset of pos.collateral) {
        if (asset.supplyApy) posDailyEarnings += (asset.amountUsd * asset.supplyApy) / 365 / 100;
      }
      for (const asset of pos.debt) {
        if (asset.borrowApy) posDailyCosts += (asset.amountUsd * asset.borrowApy) / 365 / 100;
      }
    }

    protocolTotals.set(pos.protocol, {
      collateralUsd: entry.collateralUsd + pos.totalCollateralUsd,
      dailyPnl: entry.dailyPnl + posDailyEarnings - posDailyCosts,
      atRiskPositions: entry.atRiskPositions + (pos.healthPct < 15 ? 1 : 0),
    });
  }

  const distribution: ProtocolDistribution[] = [...protocolTotals.entries()]
    .map(([protocol, data]) => ({
      protocol,
      collateralUsd: data.collateralUsd,
      pct: totalCollateral > 0 ? (data.collateralUsd / totalCollateral) * 100 : 0,
      dailyPnl: data.dailyPnl,
      atRiskPositions: data.atRiskPositions,
      monthlySavings: 0,
    }))
    .sort((a, b) => b.collateralUsd - a.collateralUsd);

  return {
    netWorth,
    dailyPnl,
    healthPct,
    atRiskPositions,
    distribution,
  };
}
