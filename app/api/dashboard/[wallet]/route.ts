import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  type NormalizedPosition,
  type ProtocolStatus,
  type DashboardResponse,
  Protocol,
} from "@/app/types/main";
import { fetchJupLendPositions } from "@/app/utils/juplend";
// fetchDriftPositions intentionally not imported, Drift is temporarily disabled.
import { fetchSavePositions } from "@/app/utils/save";
import { fetchKaminoPositions } from "@/app/utils/kamino";
import { getPositions, setPositions } from "@/app/utils/cache";
import { computeHealthCard, computeSavingsPerProtocol } from "@/app/utils/main";

type FetcherEntry = {
  protocol: Protocol;
  fn: (wallet: string) => Promise<NormalizedPosition[]>;
};

const FETCHERS: FetcherEntry[] = [
  { protocol: Protocol.JupLend, fn: fetchJupLendPositions },
  // Drift is disabled until its rate feed stabilizes, pools have been
  // spiking to 100%+ APR. Re-add this entry to bring Drift back online.
  // { protocol: Protocol.Drift, fn: fetchDriftPositions },
  { protocol: Protocol.Save, fn: fetchSavePositions },
  { protocol: Protocol.Kamino, fn: fetchKaminoPositions },
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ wallet: string }> },
) {
  const { wallet } = await params;

  try {
    new PublicKey(wallet);
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet address" },
      { status: 400 },
    );
  }

  // Cache-first: serve from cache if fresh
  const cached = getPositions(wallet);

  if (cached) {
    const [healthCard, savingsMap] = await Promise.all([
      Promise.resolve(computeHealthCard(cached)),
      computeSavingsPerProtocol(cached),
    ]);

    healthCard.distribution = healthCard.distribution.map((entry) => ({
      ...entry,
      monthlySavings: savingsMap.get(entry.protocol) ?? 0,
    }));

    const protocolStatus: ProtocolStatus[] = FETCHERS.map(({ protocol }) => ({
      protocol,
      ok: true,
      latencyMs: 0,
    }));

    const response: DashboardResponse = {
      wallet,
      healthCard,
      positions: cached,
      protocolStatus,
      timestamp: Date.now(),
    };

    return NextResponse.json(response);
  }

  // Cache miss — fan out to all protocols in parallel
  const results = await Promise.allSettled(
    FETCHERS.map(async ({ protocol, fn }) => {
      const start = Date.now();
      // TODO: Add per-fetcher timeout wrapper.
      // Prevent single protocol from blocking entire response.
      const positions = await fn(wallet);
      return {
        protocol,
        positions,
        latencyMs: Date.now() - start,
      };
    }),
  );

  // Collect positions + status from settled results
  const allPositions: NormalizedPosition[] = [];
  const protocolStatus: ProtocolStatus[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const protocol = FETCHERS[i].protocol;

    if (result.status === "fulfilled") {
      allPositions.push(...result.value.positions);
      protocolStatus.push({
        protocol,
        ok: true,
        latencyMs: result.value.latencyMs,
      });
    } else {
      console.error(`[dashboard] ${protocol} failed:`, result.reason);
      protocolStatus.push({
        protocol,
        ok: false,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Unknown error",
        latencyMs: 0,
      });
    }
  }

  // Compute health card and savings in parallel on whatever data is available
  const [healthCard, savingsMap] = await Promise.all([
    Promise.resolve(computeHealthCard(allPositions)),
    computeSavingsPerProtocol(allPositions),
  ]);

  healthCard.distribution = healthCard.distribution.map((entry) => ({
    ...entry,
    monthlySavings: savingsMap.get(entry.protocol) ?? 0,
  }));

  // Cache positions
  setPositions(wallet, allPositions);

  const response: DashboardResponse = {
    wallet,
    healthCard,
    positions: allPositions,
    protocolStatus,
    timestamp: Date.now(),
  };

  return NextResponse.json(response);
}
