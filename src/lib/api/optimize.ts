// TODO FRONTEND: We should prolly use something like react-query for this, but for now this is fine.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Protocol } from "@/app/types/main";
import type { SavingsResponse } from "@/app/types/savings";
import { fetchSavings } from "./savings";

export const PROTOCOL_DISPLAY_NAME: Record<Protocol, string> = {
  [Protocol.Kamino]: "Kamino",
  [Protocol.Drift]: "Drift",
  [Protocol.Save]: "Save",
  [Protocol.JupLend]: "Juplend",
};

export const PROTOCOL_COLOR: Record<Protocol, string> = {
  [Protocol.Kamino]: "#7c3aed",
  [Protocol.Drift]: "#2563eb",
  [Protocol.Save]: "#16a34a",
  [Protocol.JupLend]: "#ea580c",
};

const ALL_PROTOCOLS: Protocol[] = [
  Protocol.Kamino,
  Protocol.Drift,
  Protocol.Save,
  Protocol.JupLend,
];

export interface OptimizeAsset {
  mint: string;
  symbol: string;
  decimals: number;
  amount: number;
  usd: number;
  logoUrl?: string;
  // Per-asset rate from the most recent position carrying this mint.
  supplyApy?: number;
  borrowApy?: number;
  // Per-protocol tx-building meta (poolAddress / marketAddress / allReserves
  // / etc). Populated when the savings API aggregates per vault — needed to
  // build a refinance source context without a second fetch.
  meta?: Record<string, unknown>;
}

export interface OptimizeProtocol {
  protocol: Protocol;
  name: string;
  color: string;
  // Protocol-wide values computed from the user's positions.
  currentLTV: number;
  maxLTV: number | null;
  liqThreshold: number | null;
  supplyApy: number;
  borrowApy: number;
  collaterals: OptimizeAsset[];
  debts: OptimizeAsset[];
}

export interface OptimizeJuplendPair {
  id: string;
  collateralMint: string;
  collateralDecimals: number;
  debtMint: string;
  debtDecimals: number;
  collateralSymbol: string;
  debtSymbol: string;
  collateralAmount: number;
  collateralUsd: number;
  debtAmount: number;
  debtUsd: number;
  collateralLogoUrl?: string;
  debtLogoUrl?: string;
  ltv: number;
  maxLTV: number | null;
  liqThreshold: number | null;
  supplyApy: number | null;
  borrowApy: number | null;
}

export interface OptimizeData {
  protocols: OptimizeProtocol[];
  juplendPairs: OptimizeJuplendPair[];
}

export interface UseOptimizeResult {
  data: OptimizeData | null;
  error: Error | null;
  isLoading: boolean;
  refetch: (opts?: { noCache?: boolean }) => void;
}

function findRate(
  res: SavingsResponse,
  mint: string,
  side: "collateral" | "debt",
): number | undefined {
  for (const pos of res.summary.positions) {
    const list = side === "collateral" ? pos.collateral : pos.debt;
    for (const a of list) {
      if (a.mint !== mint) continue;
      const r = side === "collateral" ? a.supplyApy : a.borrowApy;
      if (r != null) return r;
    }
  }
  return undefined;
}

function buildProtocol(
  protocol: Protocol,
  res: SavingsResponse,
): OptimizeProtocol {
  const { summary } = res;

  const collaterals: OptimizeAsset[] = summary.collateral.map((c) => ({
    mint: c.mint,
    symbol: c.symbol,
    decimals: c.decimals,
    amount: c.totalAmount,
    usd: c.totalAmountUsd,
    logoUrl: c.logoUrl,
    supplyApy: findRate(res, c.mint, "collateral"),
    meta: c.meta,
  }));
  const debts: OptimizeAsset[] = summary.debt.map((d) => ({
    mint: d.mint,
    symbol: d.symbol,
    decimals: d.decimals,
    amount: d.totalAmount,
    usd: d.totalAmountUsd,
    logoUrl: d.logoUrl,
    borrowApy: findRate(res, d.mint, "debt"),
    meta: d.meta,
  }));

  // Weighted-average supply / borrow APY across all positions
  let supplyEarnings = 0;
  let supplyBase = 0;
  let borrowCosts = 0;
  let borrowBase = 0;
  for (const pos of summary.positions) {
    for (const a of pos.collateral) {
      if (a.supplyApy != null && a.amountUsd > 0) {
        supplyEarnings += (a.amountUsd * a.supplyApy) / 100;
        supplyBase += a.amountUsd;
      }
    }
    for (const a of pos.debt) {
      if (a.borrowApy != null && a.amountUsd > 0) {
        borrowCosts += (a.amountUsd * a.borrowApy) / 100;
        borrowBase += a.amountUsd;
      }
    }
  }

  const supplyApy = supplyBase > 0 ? (supplyEarnings / supplyBase) * 100 : 0;
  const borrowApy = borrowBase > 0 ? (borrowCosts / borrowBase) * 100 : 0;

  const totalCollateralUsd = summary.totalCollateralUsd;
  const totalDebtUsd = summary.totalDebtUsd;
  const currentLTV =
    totalCollateralUsd > 0
      ? Math.round((totalDebtUsd / totalCollateralUsd) * 100)
      : 0;

  return {
    protocol,
    name: PROTOCOL_DISPLAY_NAME[protocol],
    color: PROTOCOL_COLOR[protocol],
    currentLTV,
    maxLTV: summary.risk?.maxLTV ?? null,
    liqThreshold: summary.risk?.liqThreshold ?? null,
    supplyApy,
    borrowApy,
    collaterals,
    debts,
  };
}

function buildJuplendPairs(res: SavingsResponse): OptimizeJuplendPair[] {
  return res.summary.positions.map((pos): OptimizeJuplendPair => {
    const col = pos.collateral[0];
    const debt = pos.debt[0];
    const ltv =
      pos.totalCollateralUsd > 0
        ? Math.round((pos.totalDebtUsd / pos.totalCollateralUsd) * 100)
        : 0;
    return {
      id: pos.accountAddress,
      collateralMint: col?.mint ?? "",
      collateralDecimals: col?.decimals ?? 0,
      debtMint: debt?.mint ?? "",
      debtDecimals: debt?.decimals ?? 0,
      collateralSymbol: col?.symbol ?? "—",
      debtSymbol: debt?.symbol ?? "—",
      collateralAmount: col ? parseFloat(col.amount) : 0,
      collateralUsd: col?.amountUsd ?? 0,
      debtAmount: debt ? parseFloat(debt.amount) : 0,
      debtUsd: debt?.amountUsd ?? 0,
      collateralLogoUrl: col?.logoUrl,
      debtLogoUrl: debt?.logoUrl,
      ltv,
      maxLTV: pos.risk?.maxLTV ?? null,
      liqThreshold: pos.risk?.liqThreshold ?? null,
      supplyApy: col?.supplyApy ?? null,
      borrowApy: debt?.borrowApy ?? null,
    };
  });
}

export function useOptimize(wallet: string | null): UseOptimizeResult {
  const [data, setData] = useState<OptimizeData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(wallet));

  const [refetchTick, setRefetchTick] = useState(0);
  const refetchNoCache = useRef(false);

  const refetch = useCallback((opts?: { noCache?: boolean }) => {
    refetchNoCache.current = Boolean(opts?.noCache);
    setRefetchTick((t) => t + 1);
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!wallet) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const noCache = refetchNoCache.current;
    refetchNoCache.current = false;
    setIsLoading(true);
    setError(null);

    Promise.all(
      ALL_PROTOCOLS.map((p) =>
        fetchSavings(p, wallet, { signal: controller.signal, noCache }),
      ),
    )
      .then((results) => {
        const protocols = ALL_PROTOCOLS.map((p, i) =>
          buildProtocol(p, results[i]),
        );
        const juplendIdx = ALL_PROTOCOLS.indexOf(Protocol.JupLend);
        const juplendPairs = buildJuplendPairs(results[juplendIdx]);
        setData({ protocols, juplendPairs });
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });

    return () => controller.abort();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [wallet, refetchTick]);

  return { data, error, isLoading, refetch };
}
