"use client";

import { useEffect, useState } from "react";

const JUPITER_TOKEN_LIST_API =
  "https://lite-api.jup.ag/tokens/v2/tag?query=verified";

export interface TokenMeta {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}

interface JupiterToken {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
}

// Module-level cache shared across mounts; refetches on hard reload.
let cached: Map<string, TokenMeta> | null = null;
let inflight: Promise<Map<string, TokenMeta>> | null = null;

async function loadTokenMap(): Promise<Map<string, TokenMeta>> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(JUPITER_TOKEN_LIST_API);
      if (!res.ok) throw new Error(`Jupiter token list error: ${res.status}`);
      const tokens: JupiterToken[] = await res.json();
      const map = new Map<string, TokenMeta>();
      for (const t of tokens) {
        map.set(t.id, {
          mint: t.id,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          logoUrl: t.icon,
        });
      }
      cached = map;
      return map;
    } catch (err) {
      console.warn("[token-list] Failed to load Jupiter list:", err);
      const fallback = new Map<string, TokenMeta>();
      cached = fallback;
      return fallback;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export interface UseTokenListResult {
  tokens: Map<string, TokenMeta>;
  bySymbol: Map<string, TokenMeta>;
  isLoading: boolean;
}

function buildSymbolMap(byMint: Map<string, TokenMeta>): Map<string, TokenMeta> {
  // First match per symbol wins; Jupiter sorts verified entries by canonicality
  // so this works for the common majors.
  const out = new Map<string, TokenMeta>();
  for (const t of byMint.values()) {
    if (!out.has(t.symbol)) out.set(t.symbol, t);
  }
  return out;
}

export function useTokenList(): UseTokenListResult {
  const [tokens, setTokens] = useState<Map<string, TokenMeta>>(
    () => cached ?? new Map(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(cached === null);

  useEffect(() => {
    let cancelled = false;
    if (cached) {
      setTokens(cached);
      setIsLoading(false);
      return;
    }
    loadTokenMap().then((map) => {
      if (cancelled) return;
      setTokens(map);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const bySymbol = buildSymbolMap(tokens);

  return { tokens, bySymbol, isLoading };
}
