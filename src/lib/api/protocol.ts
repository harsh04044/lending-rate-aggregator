"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Protocol, type NormalizedPosition } from "@/app/types/main";
import type { SavingsResponse } from "@/app/types/savings";
import type {
  ActionType,
  HistoryEntry as ApiHistoryEntry,
  HistoryResponse,
} from "@/app/lib/discriminators";
import type {
  CollateralAsset,
  DebtAsset,
  JuplendPairPosition,
  Position,
  ProtocolDetail,
} from "@/app/(dashboard)/protocols/[slug]/page";
import type { HistoryEntry as UiHistoryEntry } from "@/app/(dashboard)/protocols/[slug]/_components/history";
import { fetchSavings } from "./savings";
import { fetchHistory } from "./history";

const SLUG_TO_PROTOCOL: Record<string, Protocol> = {
  kamino: Protocol.Kamino,
  // drift: Protocol.Drift, // disabled — re-add when Drift rate feed stabilizes
  save: Protocol.Save,
  juplend: Protocol.JupLend,
};

const DISPLAY_NAME: Record<Protocol, string> = {
  [Protocol.Kamino]: "Kamino",
  [Protocol.Drift]: "Drift",
  [Protocol.Save]: "Save",
  [Protocol.JupLend]: "Juplend",
};

const PROTOCOL_COLOR: Record<Protocol, string> = {
  [Protocol.Kamino]: "#7c3aed",
  [Protocol.Drift]: "#2563eb",
  [Protocol.Save]: "#1DB67D",
  [Protocol.JupLend]: "#1FC7D4",
};

const ACTION_MAP: Record<ActionType, UiHistoryEntry["action"]> = {
  deposit: "SUPPLY",
  withdraw: "WITHDRAW",
  borrow: "BORROW",
  repay: "REPAY",
  refinance: "REFINANCE",
};

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtSignedUsd(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${fmtUsd(Math.abs(n)).replace("$", "$")}`;
}

function fmtSignedPct(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function statusFromHealth(pct: number): Position["status"] {
  if (pct >= 60) return "Healthy";
  if (pct >= 30) return "Moderate";
  return "At Risk";
}

// Look up the most-recent supply/borrow APY for a token mint by scanning
// every position on this protocol.
function findRateByMint(
  positions: NormalizedPosition[],
  mint: string,
  side: "collateral" | "debt",
): number | undefined {
  for (const pos of positions) {
    const list = side === "collateral" ? pos.collateral : pos.debt;
    for (const a of list) {
      if (a.mint !== mint) continue;
      const rate = side === "collateral" ? a.supplyApy : a.borrowApy;
      if (rate != null) return rate;
    }
  }
  return undefined;
}

function findNameByMint(
  positions: NormalizedPosition[],
  mint: string,
): string | undefined {
  for (const pos of positions) {
    for (const a of [...pos.collateral, ...pos.debt]) {
      if (a.mint === mint && a.name) return a.name;
    }
  }
  return undefined;
}

function findPriceByMint(
  positions: NormalizedPosition[],
  mint: string,
): number | undefined {
  for (const pos of positions) {
    for (const a of [...pos.collateral, ...pos.debt]) {
      if (a.mint === mint && a.price) return a.price;
    }
  }
  return undefined;
}

function buildCollateralAssets(savings: SavingsResponse): CollateralAsset[] {
  const positions = savings.summary.positions;
  return savings.summary.collateral.map((c) => {
    const rate = findRateByMint(positions, c.mint, "collateral") ?? 0;
    const monthlyRewardUsd = (c.totalAmountUsd * rate) / 100 / 12;
    return {
      mint: c.mint,
      symbol: c.symbol,
      name: findNameByMint(positions, c.mint) ?? c.symbol,
      decimals: c.decimals,
      balance: c.totalAmount,
      balanceStr: fmtNum(c.totalAmount),
      valueUsd: fmtUsd(c.totalAmountUsd),
      valueNum: c.totalAmountUsd,
      supplyAPY: `${rate.toFixed(2)}%`,
      rewards: `${fmtUsd(monthlyRewardUsd)}/mo`,
      price: findPriceByMint(positions, c.mint) ?? 0,
      logoUrl: c.logoUrl,
      meta: c.meta,
    };
  });
}

function buildDebtAssets(savings: SavingsResponse): DebtAsset[] {
  const positions = savings.summary.positions;
  return savings.summary.debt.map((d) => {
    const rate = findRateByMint(positions, d.mint, "debt") ?? 0;
    const matchingSaving = savings.savings.find((s) => s.debtMint === d.mint);
    return {
      mint: d.mint,
      symbol: d.symbol,
      name: findNameByMint(positions, d.mint) ?? d.symbol,
      decimals: d.decimals,
      borrowed: d.totalAmount,
      borrowedStr: fmtNum(d.totalAmount),
      valueUsd: fmtUsd(d.totalAmountUsd),
      valueNum: d.totalAmountUsd,
      borrowAPR: rate,
      borrowAPRStr: `${rate.toFixed(2)}%`,
      savings: matchingSaving
        ? {
            amount: `${fmtUsd(matchingSaving.monthlySavingsUsd)}/mo`,
            protocol:
              DISPLAY_NAME[matchingSaving.bestProtocol] ??
              matchingSaving.bestProtocol,
          }
        : null,
      logoUrl: d.logoUrl,
      meta: d.meta,
    };
  });
}

function buildPairs(savings: SavingsResponse): JuplendPairPosition[] {
  // Drop zeroed slots from the rendered pair list. The data layer keeps
  // them around so the refinance picker can re-use empty positions, but
  // they have nothing useful to show in the UI.
  return savings.summary.positions
    .filter((pos) => pos.totalCollateralUsd > 0 || pos.totalDebtUsd > 0)
    .map((pos, i): JuplendPairPosition => {
    const col = pos.collateral[0];
    const debt = pos.debt[0];
    const health = Math.round(pos.healthPct);
    const ltv =
      pos.totalCollateralUsd > 0
        ? Math.round((pos.totalDebtUsd / pos.totalCollateralUsd) * 100)
        : 0;
    const colAmount = col ? parseFloat(col.amount) : 0;
    const debtAmount = debt ? parseFloat(debt.amount) : 0;
    return {
      id: pos.accountAddress || String(i),
      collateralMint: col?.mint ?? "",
      collateralSymbol: col?.symbol ?? "—",
      collateralDecimals: col?.decimals ?? 0,
      collateralAmount: colAmount,
      collateralAmountStr: col ? `${fmtNum(colAmount)} ${col.symbol}` : "—",
      collateralValueUsd: col ? fmtUsd(col.amountUsd) : "—",
      collateralLogoUrl: col?.logoUrl,
      debtMint: debt?.mint ?? "",
      debtSymbol: debt?.symbol ?? "—",
      debtDecimals: debt?.decimals ?? 0,
      debtAmount,
      debtAmountStr: debt ? `${fmtNum(debtAmount)} ${debt.symbol}` : "—",
      debtValueUsd: debt ? fmtUsd(debt.amountUsd) : "—",
      debtLogoUrl: debt?.logoUrl,
      ltv,
      maxLTV: pos.risk?.maxLTV ?? null,
      liqThreshold: pos.risk?.liqThreshold ?? null,
      health,
      status: statusFromHealth(pos.healthPct),
      netApy: pos.netApy,
      supplyApy: col?.supplyApy ?? null,
      borrowApy: debt?.borrowApy ?? null,
      meta: pos.meta,
    };
  });
}

function buildPositions(savings: SavingsResponse): Position[] {
  const out: Position[] = [];
  let nextId = 1;
  for (const pos of savings.summary.positions) {
    const status = statusFromHealth(pos.healthPct);
    const health = Math.round(pos.healthPct);
    for (const c of pos.collateral) {
      out.push({
        id: String(nextId++),
        type: "Lend",
        asset: c.symbol,
        amount: `${fmtNum(parseFloat(c.amount))} ${c.symbol}`,
        valueUsd: fmtUsd(c.amountUsd),
        apy: `${(c.supplyApy ?? 0).toFixed(2)}%`,
        health,
        status,
        logoUrl: c.logoUrl,
      });
    }
    for (const d of pos.debt) {
      out.push({
        id: String(nextId++),
        type: "Borrow",
        asset: d.symbol,
        amount: `${fmtNum(parseFloat(d.amount))} ${d.symbol}`,
        valueUsd: fmtUsd(d.amountUsd),
        apy: `${(d.borrowApy ?? 0).toFixed(2)}%`,
        health,
        status,
        logoUrl: d.logoUrl,
      });
    }
  }
  return out;
}

function buildHistory(history: HistoryResponse | null): UiHistoryEntry[] {
  if (!history) return [];
  return history.entries.map((e: ApiHistoryEntry): UiHistoryEntry => {
    const primary = e.tokens[0];
    const date = new Date(e.timestamp * 1000);
    return {
      date: date.toISOString().slice(0, 10),
      action: ACTION_MAP[e.actionType] ?? "SUPPLY",
      amount: primary ? fmtNum(parseFloat(primary.tokenAmount)) : "—",
      symbol: primary?.tokenSymbol ?? "",
      valueUsd: "",
      txHash: e.signature,
    };
  });
}

function buildProtocolDetail(
  slug: string,
  protocol: Protocol,
  savings: SavingsResponse,
  history: HistoryResponse | null,
): ProtocolDetail {
  const summary = savings.summary;
  // USD-weighted risk params from the API; null when no collateral.
  const risk = summary.risk;

  const totalCollateralNum = summary.totalCollateralUsd;
  const totalDebtNum = summary.totalDebtUsd;
  const currentLTV =
    totalCollateralNum > 0
      ? Math.round((totalDebtNum / totalCollateralNum) * 100)
      : 0;

  // Aggregate weighted supply/borrow rates
  let supplyEarningsAnnual = 0;
  let supplyBase = 0;
  let borrowCostsAnnual = 0;
  let borrowBase = 0;
  for (const pos of summary.positions) {
    for (const a of pos.collateral) {
      if (a.supplyApy != null) {
        supplyEarningsAnnual += (a.amountUsd * a.supplyApy) / 100;
        supplyBase += a.amountUsd;
      }
    }
    for (const a of pos.debt) {
      if (a.borrowApy != null) {
        borrowCostsAnnual += (a.amountUsd * a.borrowApy) / 100;
        borrowBase += a.amountUsd;
      }
    }
  }
  const supplyApy =
    supplyBase > 0 ? (supplyEarningsAnnual / supplyBase) * 100 : 0;
  const borrowApr = borrowBase > 0 ? (borrowCostsAnnual / borrowBase) * 100 : 0;
  const supplyDaily = supplyEarningsAnnual / 365;
  const borrowDaily = borrowCostsAnnual / 365;
  const netDaily = supplyDaily - borrowDaily;

  // Liquidation distance from current LTV to liq threshold.
  const ltvHeadroom =
    risk != null ? Math.max(0, risk.liqThreshold - currentLTV) : null;

  return {
    protocol,
    name: DISPLAY_NAME[protocol],
    slug,
    color: PROTOCOL_COLOR[protocol],
    safetyScore: Math.round(summary.healthPct),
    totalCollateral: fmtUsd(totalCollateralNum),
    totalCollateralNum,
    totalDebt: fmtUsd(totalDebtNum),
    totalDebtNum,
    netAPY: fmtSignedPct(summary.netApy),
    currentLTV,
    maxLTV: risk?.maxLTV ?? null,
    liqThreshold: risk?.liqThreshold ?? null,
    liquidationPrice: "—",
    liquidationDistance:
      ltvHeadroom != null ? `${ltvHeadroom.toFixed(1)}%` : "—",
    metrics: {
      borrowAPR: `${borrowApr.toFixed(2)}%`,
      supplyAPY: `${supplyApy.toFixed(2)}%`,
      health: `${Math.round(summary.healthPct)}%`,
      maxLTV: risk != null ? `${risk.maxLTV.toFixed(1)}%` : "—",
    },
    collateralAssets: buildCollateralAssets(savings),
    debtAssets: buildDebtAssets(savings),
    positions: buildPositions(savings),
    pairs: buildPairs(savings),
    history: buildHistory(history),
    supplyEarnings: fmtSignedUsd(supplyDaily),
    borrowCosts: fmtSignedUsd(-borrowDaily),
    netDaily: fmtSignedUsd(netDaily),
  };
}

export interface UseProtocolResult {
  data: ProtocolDetail | null;
  error: Error | null;
  isLoading: boolean;
  isUnknownSlug: boolean;
  refetch: (opts?: { noCache?: boolean }) => void;
}

export function useProtocol(
  slug: string,
  wallet: string | null,
): UseProtocolResult {
  const protocol = SLUG_TO_PROTOCOL[slug];
  const [data, setData] = useState<ProtocolDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(
    Boolean(wallet) && Boolean(protocol),
  );

  const [refetchTick, setRefetchTick] = useState(0);
  const refetchIntent = useRef<{ silent: boolean; noCache: boolean }>({
    silent: false,
    noCache: false,
  });

  useEffect(() => {
    if (!protocol || !wallet) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const { silent, noCache } = refetchIntent.current;
    refetchIntent.current = { silent: false, noCache: false };

    const controller = new AbortController();
    if (!silent) {
      setData(null);
      setIsLoading(true);
    }
    setError(null);

    const savingsPromise = fetchSavings(protocol, wallet, {
      signal: controller.signal,
      noCache,
    });
    // History endpoint can fail (e.g. Helius rate-limit). Treat as best-effort.
    const historyPromise: Promise<HistoryResponse | null> = fetchHistory(
      protocol,
      wallet,
      { signal: controller.signal, noCache },
    ).catch(() => null);

    Promise.all([savingsPromise, historyPromise])
      .then(([savings, history]) => {
        setData(buildProtocolDetail(slug, protocol, savings, history));
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [slug, protocol, wallet, refetchTick]);

  const refetch = useCallback((opts?: { noCache?: boolean }) => {
    refetchIntent.current = {
      silent: true,
      noCache: opts?.noCache ?? false,
    };
    setRefetchTick((t) => t + 1);
  }, []);

  return {
    data,
    error,
    isLoading,
    isUnknownSlug: !protocol,
    refetch,
  };
}
