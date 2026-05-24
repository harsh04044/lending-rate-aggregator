// TODO:
// Current cache uses a single timestamp for all protocols.
// This is fine because we fetch all protocols together.
// If we introduce partial refresh (per-protocol updates),
// this MUST be changed to per-protocol timestamps.

// TODO: Current approach is a in-memory cache, we'll change it in the future, we'll support redis or something.

// TODO: Consider decreasing CACHE_TTL_MS — 15 min may be too stale for volatile DeFi data.
// Per-protocol TTLs should be introduced alongside partial refresh, not before.

// TODO: Add request deduplication or locking per wallet.
// Prevent concurrent fetches from overwriting each other.

import type { NormalizedPosition, Protocol } from "@/app/types/main";

interface CacheEntry {
  positions: NormalizedPosition[];
  timestamp: number;
  // Tracks which protocols have been explicitly fetched and stored.
  // A protocol absent from this set means it was never fetched — not that it has no positions.
  fetchedProtocols: Set<Protocol>;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function setPositions(
  wallet: string,
  positions: NormalizedPosition[],
): void {
  const protocols = new Set(positions.map((p) => p.protocol));
  cache.set(wallet, {
    positions,
    timestamp: Date.now(),
    fetchedProtocols: protocols,
  });
}

export function getPositions(wallet: string): NormalizedPosition[] | null {
  const entry = cache.get(wallet);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(wallet);
    return null;
  }
  return entry.positions;
}

/**
 * Filter cached positions by protocol.
 * Returns null if cache miss OR if this protocol has never been explicitly fetched.
 */
export function getPositionsByProtocol(
  wallet: string,
  protocol: Protocol,
): NormalizedPosition[] | null {
  const entry = cache.get(wallet);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(wallet);
    return null;
  }
  if (!entry.fetchedProtocols.has(protocol)) return null;
  return entry.positions.filter((p) => p.protocol === protocol);
}

/**
 * Set positions for a single protocol, merging with existing cached data.
 * Replaces any existing positions for that protocol, keeps others intact.
 */
export function setPositionsByProtocol(
  wallet: string,
  protocol: Protocol,
  positions: NormalizedPosition[],
): void {
  const entry = cache.get(wallet);
  const existing = entry?.positions ?? [];
  const fetchedProtocols = new Set(entry?.fetchedProtocols ?? []);

  const filtered = existing.filter((p) => p.protocol !== protocol);
  const incomingAddresses = new Set(positions.map((p) => p.accountAddress));
  const deduped = filtered.filter(
    (p) => !incomingAddresses.has(p.accountAddress),
  );

  fetchedProtocols.add(protocol);
  cache.set(wallet, {
    positions: [...deduped, ...positions],
    timestamp: Date.now(),
    fetchedProtocols,
  });
}

// Invalidate cache for a wallet — call after user submits a tx through the app.
export function invalidate(wallet: string, protocols?: Protocol[]): void {
  if (!protocols || protocols.length === 0) {
    cache.delete(wallet);
    return;
  }

  const entry = cache.get(wallet);
  if (!entry) return;

  const drop = new Set(protocols);
  const remainingProtocols = new Set(entry.fetchedProtocols);
  for (const p of drop) remainingProtocols.delete(p);

  // Keep the entry's other protocols intact, but mark the dropped ones as
  // never-fetched so the next read for them is a cache miss to fresh fetch.
  cache.set(wallet, {
    positions: entry.positions.filter((p) => !drop.has(p.protocol)),
    timestamp: entry.timestamp,
    fetchedProtocols: remainingProtocols,
  });
}
