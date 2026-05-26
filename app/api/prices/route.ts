import { NextResponse } from "next/server";

// Single-source price proxy. Sits between the frontend and Jupiter so we
// can:
//   - cache shared across users (one Jupiter call per mint per TTL window
//     instead of one per browser tab)
//   - swap providers / add Pyth fallback in one place later
//   - control rate-limit blast radius if Jupiter throttles us
//
// The on-instance Map cache is intentionally process-local. For multi-
// instance deployments a Redis-backed cache would replace this without
// changing the wire shape.

const JUPITER_PRICE_API = "https://lite-api.jup.ag/price/v3";
const PRICE_TTL_MS = 30 * 1000; // 30s — quote freshness vs. provider load
const MAX_IDS_PER_CALL = 100;   // Jupiter caps; we just stay well under

interface CacheEntry {
  price: number;
  ts: number;
}

interface JupiterEntry {
  usdPrice?: number;
  // Other fields from v3 (createdAt, liquidity, blockId, decimals,
  // priceChange24h) ignored — the modal only needs USD price for now.
}

const priceCache = new Map<string, CacheEntry>();

function isFresh(entry: CacheEntry | undefined, now: number): entry is CacheEntry {
  return Boolean(entry && now - entry.ts < PRICE_TTL_MS);
}

async function fetchFromJupiter(
  mints: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (mints.length === 0) return out;

  // Batch into chunks defensively; Jupiter v3 currently accepts large
  // batches but chunking insulates us from changes.
  for (let i = 0; i < mints.length; i += MAX_IDS_PER_CALL) {
    const chunk = mints.slice(i, i + MAX_IDS_PER_CALL);
    const url = `${JUPITER_PRICE_API}?ids=${chunk
      .map(encodeURIComponent)
      .join(",")}`;
    const res = await fetch(url, {
      // Tiny timeout via AbortController — Jupiter is usually <500ms; if
      // it's degraded we'd rather fail fast and return what we have.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      // Don't poison the cache on transient upstream failures — just skip
      // this chunk and let the caller surface what we have.
      console.error(`[prices] Jupiter ${res.status} for ${chunk.length} mints`);
      continue;
    }
    const body = (await res.json()) as Record<string, JupiterEntry | null>;
    for (const [mint, entry] of Object.entries(body)) {
      if (!entry || typeof entry.usdPrice !== "number") continue;
      if (!Number.isFinite(entry.usdPrice)) continue;
      out.set(mint, entry.usdPrice);
    }
  }

  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsRaw = searchParams.get("ids") ?? "";
  // Dedupe + trim. Empty entries from trailing commas are dropped.
  const requested = Array.from(
    new Set(
      idsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );

  if (requested.length === 0) {
    return NextResponse.json({ prices: {} });
  }

  const now = Date.now();
  const result: Record<string, number> = {};
  const stale: string[] = [];

  for (const mint of requested) {
    const cached = priceCache.get(mint);
    if (isFresh(cached, now)) {
      result[mint] = cached.price;
    } else {
      stale.push(mint);
    }
  }

  if (stale.length > 0) {
    try {
      const fresh = await fetchFromJupiter(stale);
      for (const [mint, price] of fresh) {
        priceCache.set(mint, { price, ts: now });
        result[mint] = price;
      }
    } catch (err) {
      // Network / abort failures: fall back to whatever we already have
      // in cache (even if stale) rather than 500-ing the whole request.
      console.error("[prices] Jupiter fetch failed:", err);
      for (const mint of stale) {
        const cached = priceCache.get(mint);
        if (cached) result[mint] = cached.price;
      }
    }
  }

  return NextResponse.json({ prices: result });
}
