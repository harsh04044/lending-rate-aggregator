import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import type {
  SavingsResponse,
  DebtSaving,
  ProtocolSummary,
  AggregatedToken,
} from "@/app/types/savings";
import {
  getPositionsByProtocol,
  setPositionsByProtocol,
} from "@/app/utils/cache";
import { fetchJupLendPositions } from "@/app/utils/juplend";
import { fetchDriftPositions } from "@/app/utils/drift";
import { fetchSavePositions } from "@/app/utils/save";
import { fetchKaminoPositions } from "@/app/utils/kamino";
import { fetchBorrowRates } from "@/app/utils/borrow-rates";
import { computeProtocolRisk } from "@/app/utils/main";
import { NormalizedPosition, Protocol } from "@/app/types/main";

const VALID_PROTOCOLS: Protocol[] = [
  Protocol.JupLend,
  Protocol.Drift,
  Protocol.Save,
  Protocol.Kamino,
];
const MIN_SAVINGS_THRESHOLD = 5; // $5/mo — ignore below this

// ─── Protocol Fetcher Map ────────────────────────────────────────────────────

const PROTOCOL_FETCHERS: Record<
  Protocol,
  (wallet: string) => Promise<NormalizedPosition[]>
> = {
  JupLend: fetchJupLendPositions,
  Drift: fetchDriftPositions,
  Save: fetchSavePositions,
  Kamino: fetchKaminoPositions,
};

// ─── Protocol Summary ───────────────────────────────────────────────────────

// How to fold a protocol's positions into UI rows.
//   true : one row per (mint, source-position)
//   false: one row per mint (positions of the same mint are summed)
//
// Set to true when either is true:
//   1. The protocol has per-position rates (e.g. JupLend's per-vault APYs),
//      so summing across positions would hide rate differences.
//   2. The action modal must dispatch against a specific position (e.g.
//      Kamino's Main vs JLP markets are separate obligations, a row for
//      "SOL" is meaningless without knowing which market it belongs to).
//
// Set to false for pool-style protocols where every position of a given
// mint shares one global rate and the modal can act on the aggregated
// total
const PER_VAULT_AGGREGATION: Record<Protocol, boolean> = {
  [Protocol.JupLend]: true,
  [Protocol.Kamino]: true,
  [Protocol.Drift]: false,
  [Protocol.Save]: true,
};

type AggBucket = {
  mint: string;
  symbol: string;
  logoUrl: string;
  decimals: number;
  totalAmount: number;
  totalAmountUsd: number;
  vaultId?: number;
  accountAddress?: string;
  supplyApy?: number;
  borrowApy?: number;
  // Per-protocol tx-building meta. For per-vault-aggregated protocols this
  // can carry position-specific identifiers (Kamino: marketAddress +
  // reserveAddress) that the modal needs to dispatch the right tx.
  meta?: Record<string, unknown>;
};

function computeProtocolSummary(
  protocol: Protocol,
  positions: NormalizedPosition[],
): ProtocolSummary {
  const aggregateByVault = PER_VAULT_AGGREGATION[protocol] ?? false;

  const collateralMap = new Map<string, AggBucket>();
  const debtMap = new Map<string, AggBucket>();

  let totalCollateralUsd = 0;
  let totalDebtUsd = 0;
  let totalSupplyEarnings = 0;
  let totalBorrowCosts = 0;

  // Health — debt-weighted average
  let weightedHealthSum = 0;
  let totalDebtWeight = 0;

  for (const pos of positions) {
    // Skip empty (zeroed) positions when bucketing into the per-asset
    // aggregation. They're kept in the raw positions list (for the
    // refinance picker to find reusable slots) but contribute no useful
    // collateral/debt rows to the UI.
    if (pos.totalCollateralUsd <= 0 && pos.totalDebtUsd <= 0) continue;

    const vaultId =
      typeof pos.meta?.vaultId === "number"
        ? (pos.meta.vaultId as number)
        : undefined;

    // Per-asset meta gets merged with the parent position's meta when this
    // protocol aggregates per-vault. The asset meta carries asset-specific
    // bits (e.g. Kamino reserveAddress) and the position meta carries
    // position-wide bits (e.g. Kamino marketAddress). Together they're
    // enough for the modal to dispatch a tx without a second lookup.
    const buildBucketMeta = (assetMeta: Record<string, unknown> | undefined) =>
      aggregateByVault
        ? { ...(pos.meta ?? {}), ...(assetMeta ?? {}) }
        : undefined;

    for (const asset of pos.collateral) {
      const key = aggregateByVault
        ? `${asset.mint}:${pos.accountAddress}`
        : asset.mint;
      const existing = collateralMap.get(key);
      const amount = parseFloat(asset.amount) || 0;

      if (existing) {
        existing.totalAmount += amount;
        existing.totalAmountUsd += asset.amountUsd;
      } else {
        collateralMap.set(key, {
          mint: asset.mint,
          symbol: asset.symbol,
          logoUrl: asset.logoUrl,
          decimals: asset.decimals,
          totalAmount: amount,
          totalAmountUsd: asset.amountUsd,
          ...(aggregateByVault && {
            vaultId,
            accountAddress: pos.accountAddress,
            supplyApy: asset.supplyApy,
            meta: buildBucketMeta(asset.meta),
          }),
        });
      }
      totalCollateralUsd += asset.amountUsd;

      if (asset.supplyApy) {
        totalSupplyEarnings += (asset.amountUsd * asset.supplyApy) / 100;
      }
    }

    for (const asset of pos.debt) {
      const key = aggregateByVault
        ? `${asset.mint}:${pos.accountAddress}`
        : asset.mint;
      const existing = debtMap.get(key);
      const amount = parseFloat(asset.amount) || 0;

      if (existing) {
        existing.totalAmount += amount;
        existing.totalAmountUsd += asset.amountUsd;
      } else {
        debtMap.set(key, {
          mint: asset.mint,
          symbol: asset.symbol,
          logoUrl: asset.logoUrl,
          decimals: asset.decimals,
          totalAmount: amount,
          totalAmountUsd: asset.amountUsd,
          ...(aggregateByVault && {
            vaultId,
            accountAddress: pos.accountAddress,
            borrowApy: asset.borrowApy,
            meta: buildBucketMeta(asset.meta),
          }),
        });
      }
      totalDebtUsd += asset.amountUsd;

      if (asset.borrowApy) {
        totalBorrowCosts += (asset.amountUsd * asset.borrowApy) / 100;
      }
    }

    // Debt-weighted health
    if (pos.totalDebtUsd > 0) {
      weightedHealthSum += pos.healthPct * pos.totalDebtUsd;
      totalDebtWeight += pos.totalDebtUsd;
    }
  }

  const collateral: AggregatedToken[] = [...collateralMap.values()].sort(
    (a, b) => b.totalAmountUsd - a.totalAmountUsd,
  );

  const debt: AggregatedToken[] = [...debtMap.values()].sort(
    (a, b) => b.totalAmountUsd - a.totalAmountUsd,
  );

  // Net APY relative to deployed capital
  const netApyUsd = totalSupplyEarnings - totalBorrowCosts; // annual
  const netApy =
    totalCollateralUsd > 0 ? (netApyUsd / totalCollateralUsd) * 100 : 0;

  const healthPct =
    totalDebtWeight > 0 ? weightedHealthSum / totalDebtWeight : 100;

  return {
    totalCollateralUsd,
    totalDebtUsd,
    netApy,
    netApyUsd,
    healthPct,
    risk: computeProtocolRisk(positions),
    collateral,
    debt,
    positions,
  };
}

// TODO: Right now, we just check and compare the debt rate user has in one protocol,
// and is it lower on another protocol. But what we don't check rn is ltv or all the other things,
// we'll add those checks too. We should consider collateral and supply apy here too
// because that would be more of a holistic approach, that would give us an accurate result (net apy, net savings)
// Future improvement:
// - Compute "feasible migratable amount" = min(debt, LTV cap, liquidity).
// - Compare net APY across protocols (not just borrow rate).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ protocol: string }> },
) {
  const { protocol } = await params;
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");

  if (!wallet) {
    return NextResponse.json(
      { error: "Missing wallet query param" },
      { status: 400 },
    );
  }

  try {
    new PublicKey(wallet);
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet address" },
      { status: 400 },
    );
  }

  if (!VALID_PROTOCOLS.includes(protocol as Protocol)) {
    return NextResponse.json(
      {
        error: `Invalid protocol. Must be one of: ${VALID_PROTOCOLS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const protocolName = protocol as Protocol;

  // noCache=1 forces a fresh on-chain read. The freshly-fetched positions
  // are still written back via setPositionsByProtocol so subsequent
  // requests from any surface (dashboard, history) get the same fresh data
  // without paying the on-chain fetch cost themselves.
  const noCache = searchParams.get("noCache") === "1";

  let positions = noCache
    ? null
    : getPositionsByProtocol(wallet, protocolName);

  if (!positions) {
    const fetcher = PROTOCOL_FETCHERS[protocolName];
    const fetched = await fetcher(wallet);
    setPositionsByProtocol(wallet, protocolName, fetched);
    positions = fetched;
  }

  // Compute aggregated protocol summary
  const summary = computeProtocolSummary(protocolName, positions);

  if (positions.length === 0) {
    const response: SavingsResponse = {
      wallet,
      protocol: protocolName,
      summary,
      totalMonthlySavings: null,
      savings: [],
    };
    return NextResponse.json(response);
  }

  // Collect all debt contexts across all positions
  const debtContexts = positions.flatMap((pos) => {
    const collateralMints = pos.collateral.map((c) => c.mint);
    return pos.debt
      .filter((asset) => asset.borrowApy && asset.amountUsd >= 1)
      .map((asset) => ({
        asset,
        collateralMints,
        positionId: pos.meta?.positionId as number | undefined,
      }));
  });

  // Fetch all borrow rates in parallel
  const rateResults = await Promise.allSettled(
    debtContexts.map((ctx) =>
      fetchBorrowRates(ctx.asset.mint, ctx.collateralMints),
    ),
  );

  // Process results
  const savings: DebtSaving[] = [];

  for (let i = 0; i < debtContexts.length; i++) {
    const { asset, positionId } = debtContexts[i];
    const result = rateResults[i];

    if (result.status !== "fulfilled") continue;

    const alternatives = result.value.filter(
      (r) => r.protocol !== protocolName,
    );
    if (alternatives.length === 0) continue;

    const best = alternatives.reduce((a, b) =>
      a.borrowApr < b.borrowApr ? a : b,
    );

    // TODO: for borrowApy, validate it, if it does exist or not!
    if (best.borrowApr >= asset.borrowApy!) continue;

    const monthlySavingsUsd =
      (asset.amountUsd * (asset.borrowApy! - best.borrowApr)) / 100 / 12;

    if (monthlySavingsUsd < MIN_SAVINGS_THRESHOLD) continue;

    savings.push({
      debtMint: asset.mint,
      debtSymbol: asset.symbol,
      debtAmountUsd: asset.amountUsd,
      currentProtocol: protocolName,
      currentBorrowApr: asset.borrowApy!,
      bestProtocol: best.protocol,
      bestBorrowApr: best.borrowApr,
      monthlySavingsUsd,
      ...(positionId != null && { positionId }),
      ...(best.collateralMint && { bestCollateralMint: best.collateralMint }),
      ...(best.vaultId != null && { bestVaultId: best.vaultId }),
    });
  }

  const totalMonthlySavings =
    savings.length > 0
      ? savings.reduce((sum, s) => sum + s.monthlySavingsUsd, 0)
      : null;

  const response: SavingsResponse = {
    wallet,
    protocol: protocolName,
    summary,
    totalMonthlySavings,
    savings,
  };

  return NextResponse.json(response);
}
