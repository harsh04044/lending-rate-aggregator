"use client";

import { useEffect, useState } from "react";
import { Protocol } from "@/app/types/main";
import { apiGet } from "./client";

export interface MarketOption {
  protocol: Protocol;
  available: boolean;
  reason?: string;
  supplyApy?: number;
  borrowApy?: number;
  netApy?: number;
  ltv?: number;
  liquidationThreshold?: number;
  meta?: Record<string, unknown>;
}

export interface MarketComparisonResponse {
  collateralMint: string;
  collateralSymbol: string;
  debtMint?: string;
  debtSymbol?: string;
  markets: MarketOption[];
}

export interface UseMarketComparisonResult {
  data: MarketComparisonResponse | null;
  error: Error | null;
  isLoading: boolean;
}

export function useMarketComparison(
  collateralMint: string | null,
  debtMint?: string | null,
): UseMarketComparisonResult {
  const [data, setData] = useState<MarketComparisonResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(collateralMint));

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!collateralMint) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const qs = debtMint ? `?debtMint=${encodeURIComponent(debtMint)}` : "";
    const path = `/api/market-comparison/${encodeURIComponent(collateralMint)}${qs}`;

    apiGet<MarketComparisonResponse>(path)
      .then((res) => {
        if (cancelled) return;
        setData(res);
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
  }, [collateralMint, debtMint]);

  return { data, error, isLoading };
}
