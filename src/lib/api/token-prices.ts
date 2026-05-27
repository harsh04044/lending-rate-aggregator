"use client";

import { useEffect, useState } from "react";

// Hits our own /api/prices proxy instead of Jupiter directly so we get
// the shared server-side TTL cache and can swap providers without a
// frontend change.
const PRICES_API = "/api/prices";

interface PricesResponse {
  prices: Record<string, number>;
}

export interface UseTokenPricesResult {
  prices: Map<string, number>;
  error: Error | null;
  isLoading: boolean;
}

// Fetch USD prices for an arbitrary set of mints. Re-fires whenever the
// stable-stringified mint list changes.
export function useTokenPrices(
  mints: (string | null | undefined)[],
): UseTokenPricesResult {
  const stableMints = mints
    .filter((m): m is string => typeof m === "string" && m.length > 0)
    .sort();
  const key = stableMints.join(",");

  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!key) {
      setPrices(new Map());
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(`${PRICES_API}?ids=${encodeURIComponent(key)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Prices API ${res.status}`);
        return res.json() as Promise<PricesResponse>;
      })
      .then((body) => {
        if (cancelled) return;
        const next = new Map<string, number>();
        for (const [mint, n] of Object.entries(body.prices ?? {})) {
          if (typeof n === "number" && Number.isFinite(n)) next.set(mint, n);
        }
        setPrices(next);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key]);

  return { prices, error, isLoading };
}
