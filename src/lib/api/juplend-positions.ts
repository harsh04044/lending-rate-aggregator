"use client";

import { useEffect, useState } from "react";

import { Protocol } from "@/app/types/main";
import type { JupLendPositionLite } from "@/src/lib/tx/refinance";

import { invalidatePositionsCache } from "./invalidate";
import { fetchSavings } from "./savings";

export interface UseJupLendUserPositionsResult {
  positions: JupLendPositionLite[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useJupLendUserPositions(
  wallet: string | null,
  enabled: boolean,
): UseJupLendUserPositionsResult {
  const [positions, setPositions] = useState<JupLendPositionLite[] | undefined>(
    undefined,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!wallet || !enabled) return;

    const controller = new AbortController();
    setIsLoading(true);

    fetchSavings(Protocol.JupLend, wallet, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        const projected: JupLendPositionLite[] = res.summary.positions
          .map((p) => {
            const meta = p.meta as
              | { positionId?: number; vaultId?: number }
              | undefined;
            if (meta?.positionId == null || meta?.vaultId == null) return null;
            return {
              id: meta.positionId,
              vaultId: meta.vaultId,
              supplyRaw: p.collateral[0]?.amount ?? "0",
              borrowRaw: p.debt[0]?.amount ?? "0",
              isLiquidated: false,
            };
          })
          .filter((p): p is JupLendPositionLite => p !== null);
        setPositions(projected);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [wallet, enabled]);

  return { positions, isLoading, error };
}

export function invalidateJupLendPositionsCache(wallet: string) {
  void invalidatePositionsCache(wallet, [Protocol.JupLend]);
}
