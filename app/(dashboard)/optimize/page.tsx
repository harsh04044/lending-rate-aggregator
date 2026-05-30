"use client";

import { useMemo, useState } from "react";
import {
  Zap,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  ChevronDown,
  Check,
} from "lucide-react";
import { PageHeader } from "@/src/components/page-header";
import { MainCard } from "@/src/components/main-card";
import { ActionButton } from "@/src/components/ui/action-button";
import { Title3 } from "@/src/components/ui/title-3";
import { Title4 } from "@/src/components/ui/title-4";
import {
  ProtocolIcon,
  TokenPairIcon,
} from "@/src/components/icons/token-icons";
import { AssetDropdown, MetricRow } from "@/src/components/optimize";
import { Protocol } from "@/app/types/main";
import {
  RefinanceModal,
  type RefinanceModalAsset,
  type RefinanceModalProto,
} from "./_components/refinance-modal";
import {
  PROTOCOL_DISPLAY_NAME,
  useJupLendUserPositions,
  useMarketComparison,
  useOptimize,
} from "@/src/lib/api";
import type {
  OptimizeAsset,
  OptimizeJuplendPair,
  OptimizeProtocol,
  MarketOption,
} from "@/src/lib/api";
import { invalidatePositionsCache } from "@/src/lib/api/invalidate";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { buildMigrateHandler } from "@/src/lib/tx/refinance-dispatcher";
import type { FromPositionContext } from "@/src/lib/tx/refinance-dispatcher";
import { C } from "@/src/lib/theme";
import { useConnectedWallet } from "@/src/components/wallet/useConnectedWallet";
import { ConnectWalletGate } from "@/src/components/wallet/connect-wallet";
import { Skeleton } from "@/src/components/ui/skeleton";
import { OptimizePageSkeleton } from "./_components/optimize-page-skeleton";

// TODO: We're probably not reusing the components from optimize.tsx file, we'll have to check it, and add a common folder for shared components

// Drift is hidden in the UI for now; the data layer still supports it.
// Add it back here (and remove from HIDDEN_PROTOCOLS) to re-enable.
const ALL_PROTOCOLS: Protocol[] = [
  Protocol.Kamino,
  Protocol.Save,
  Protocol.JupLend,
];

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

// Pulls the per-protocol tx-builder bits out of an OptimizeAsset.meta
// (which mirrors the AggregatedToken meta the savings API emits). Mirrors
// the helper inside the per-protocol Optimize tab so refinance source
// context works the same on both surfaces.
function buildSourceMeta(
  protocol: Protocol,
  colAsset: OptimizeAsset,
  debtAsset: OptimizeAsset,
): Record<string, unknown> | undefined {
  if (protocol === Protocol.Save) {
    const colMeta = colAsset.meta as
      | {
          poolAddress?: string;
          authorityAddress?: string;
          lookupTableAddress?: string;
          allReserves?: Array<{ address: string } & Record<string, unknown>>;
          reserveAddress?: string;
        }
      | undefined;
    const debtMeta = debtAsset.meta as { reserveAddress?: string } | undefined;
    if (!colMeta?.allReserves) return undefined;

    const collateralReserve = colMeta.allReserves.find(
      (r) => r.address === colMeta.reserveAddress,
    );
    const debtReserve = colMeta.allReserves.find(
      (r) => r.address === debtMeta?.reserveAddress,
    );

    return {
      poolAddress: colMeta.poolAddress,
      authorityAddress: colMeta.authorityAddress,
      lookupTableAddress: colMeta.lookupTableAddress,
      allReserves: colMeta.allReserves,
      collateralReserve,
      debtReserve,
    };
  }

  if (protocol === Protocol.Kamino) {
    const colMeta = colAsset.meta as { marketAddress?: string } | undefined;
    if (!colMeta?.marketAddress) return undefined;
    return { marketAddress: colMeta.marketAddress };
  }

  return undefined;
}

export default function OptimizePage() {
  const {
    address: walletAddress,
    isConnected,
    isInitializing,
  } = useConnectedWallet();
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const { data, error, isLoading, refetch } = useOptimize(walletAddress);

  const protocols = useMemo(
    () =>
      (data?.protocols ?? []).filter((p) => ALL_PROTOCOLS.includes(p.protocol)),
    [data],
  );
  // JupLend's data layer keeps zeroed pair slots around as reuse targets
  // for the refinance picker. Filter them out at the render layer so the
  // Optimize page picker only shows pairs with real collateral.
  const juplendPairs = useMemo(
    () => (data?.juplendPairs ?? []).filter((p) => p.collateralAmount > 0),
    [data],
  );

  // Default selections derived from data; overridable via state.
  const defaultFrom: Protocol | null = useMemo(() => {
    const withPositions = protocols.find(
      (p) => p.collaterals.length > 0 || p.debts.length > 0,
    );
    return withPositions?.protocol ?? protocols[0]?.protocol ?? null;
  }, [protocols]);
  const defaultTo: Protocol | null = useMemo(() => {
    if (defaultFrom == null) return null;
    return ALL_PROTOCOLS.find((p) => p !== defaultFrom) ?? null;
  }, [defaultFrom]);

  const [fromOverride, setFromOverride] = useState<Protocol | null>(null);
  const [toOverride, setToOverride] = useState<Protocol | null>(null);
  const [colSym, setColSym] = useState<string | null>(null);
  const [debtSym, setDebtSym] = useState<string | null>(null);
  const [pairId, setPairId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const fromProtocol = fromOverride ?? defaultFrom;
  const toProtocol = toOverride ?? defaultTo;

  const fromProto: OptimizeProtocol | null =
    protocols.find((p) => p.protocol === fromProtocol) ?? null;
  const toProto: OptimizeProtocol | null =
    protocols.find((p) => p.protocol === toProtocol) ?? null;

  const isFromJuplend = fromProtocol === Protocol.JupLend;

  const colAsset: OptimizeAsset | null = useMemo(() => {
    if (!fromProto) return null;
    if (colSym) {
      const m = fromProto.collaterals.find((a) => a.symbol === colSym);
      if (m) return m;
    }
    return fromProto.collaterals[0] ?? null;
  }, [fromProto, colSym]);

  const debtAsset: OptimizeAsset | null = useMemo(() => {
    if (!fromProto) return null;
    if (debtSym) {
      const m = fromProto.debts.find((a) => a.symbol === debtSym);
      if (m) return m;
    }
    return fromProto.debts[0] ?? null;
  }, [fromProto, debtSym]);

  const pair: OptimizeJuplendPair | null = useMemo(() => {
    if (!isFromJuplend) return null;
    if (pairId) {
      const m = juplendPairs.find((p) => p.id === pairId);
      if (m) return m;
    }
    return juplendPairs[0] ?? null;
  }, [isFromJuplend, pairId, juplendPairs]);

  // Selection summary for market comparison + savings math.
  const fromCollateralMint = isFromJuplend
    ? (pair?.collateralMint ?? null)
    : (colAsset?.mint ?? null);
  const fromDebtMint = isFromJuplend
    ? (pair?.debtMint ?? null)
    : (debtAsset?.mint ?? null);

  const fromCollateralSymbol = isFromJuplend
    ? pair?.collateralSymbol
    : colAsset?.symbol;
  const fromDebtSymbol = isFromJuplend ? pair?.debtSymbol : debtAsset?.symbol;

  const debtUsd = isFromJuplend ? (pair?.debtUsd ?? 0) : (debtAsset?.usd ?? 0);

  const fromLTV = isFromJuplend
    ? (pair?.ltv ?? 0)
    : (fromProto?.currentLTV ?? 0);
  const fromMaxLTV = isFromJuplend
    ? (pair?.maxLTV ?? null)
    : (fromProto?.maxLTV ?? null);
  const fromLiqThreshold = isFromJuplend
    ? (pair?.liqThreshold ?? null)
    : (fromProto?.liqThreshold ?? null);

  const fromSupplyApy = isFromJuplend
    ? (pair?.supplyApy ?? null)
    : (colAsset?.supplyApy ?? null);
  const fromBorrowApy = isFromJuplend
    ? (pair?.borrowApy ?? null)
    : (debtAsset?.borrowApy ?? null);

  const { data: comparison, isLoading: marketLoading } = useMarketComparison(
    fromCollateralMint,
    fromDebtMint,
  );

  const toMarket: MarketOption | undefined = useMemo(() => {
    if (toProtocol == null) return undefined;
    return comparison?.markets.find((m) => m.protocol === toProtocol);
  }, [comparison, toProtocol]);

  // JupLend vaultId for this collateral/debt pair, when JupLend is in the
  // comparison. Used by flash-loan-only flows (e.g. Kamino → Save) to
  // borrow the JupLend vault's LUT without making JupLend a participant.
  // Falls back to undefined when no JupLend pair exists; the prepare layer
  // tolerates that.
  const auxJupLendVaultId = useMemo(() => {
    const jup = comparison?.markets.find(
      (m) => m.protocol === Protocol.JupLend,
    );
    if (!jup?.available) return undefined;
    const meta = jup.meta as { vaultId?: number } | undefined;
    return meta?.vaultId;
  }, [comparison]);

  const wantsJupLendTarget = toProtocol === Protocol.JupLend;
  const { positions: userJupLendPositions } = useJupLendUserPositions(
    publicKey ? publicKey.toBase58() : null,
    wantsJupLendTarget,
  );

  // Per-protocol tx-builder context for the source position. JupLend's
  // pair carries everything in `pair`, so fromCtx is undefined there.
  const fromCtx: FromPositionContext | undefined = useMemo(() => {
    if (isFromJuplend) return undefined;
    if (!colAsset || !debtAsset || fromProtocol == null) return undefined;
    return {
      collateralMint: colAsset.mint,
      collateralDecimals: colAsset.decimals,
      collateralSymbol: colAsset.symbol,
      debtMint: debtAsset.mint,
      debtDecimals: debtAsset.decimals,
      debtSymbol: debtAsset.symbol,
      meta: buildSourceMeta(fromProtocol, colAsset, debtAsset),
    };
  }, [isFromJuplend, colAsset, debtAsset, fromProtocol]);

  const monthlySavings = useMemo(() => {
    if (!toMarket?.available) return 0;
    if (toMarket.borrowApy == null || fromBorrowApy == null) return 0;
    const delta = fromBorrowApy - toMarket.borrowApy;
    if (delta <= 0) return 0;
    return ((delta / 100) * debtUsd) / 12;
  }, [toMarket, fromBorrowApy, debtUsd]);

  const fromReady = isFromJuplend
    ? Boolean(pair && pair.collateralMint && pair.debtMint)
    : Boolean(colAsset && debtAsset);

  // Kamino blocks refinancing TO JupLend at the program level, so atomic
  // migration isn't possible. Mirror the per-protocol tab's gating + warn.
  const kaminoToJupLendBlocked =
    fromProtocol === Protocol.Kamino && toProtocol === Protocol.JupLend;

  const canMigrate =
    fromReady &&
    Boolean(toMarket?.available) &&
    fromProtocol !== toProtocol &&
    !kaminoToJupLendBlocked;

  // While the wallet adapter is still resolving (auto-connect, hydration),
  // show the skeleton instead of the connect gate so it doesn't flash.
  if (isInitializing) {
    return <OptimizePageSkeleton />;
  }

  if (!isConnected) {
    return (
      <div className="relative z-10">
        <PageHeader title="Optimize" icon={Zap} />
        <ConnectWalletGate
          title="Connect your wallet to optimize"
          description="Connect a Solana wallet to compare borrow rates and migrate positions across protocols."
        />
      </div>
    );
  }

  if (isLoading && !data) {
    return <OptimizePageSkeleton />;
  }

  if (error) {
    return (
      <div className="relative z-10">
        <PageHeader title="Optimize" icon={Zap} />
        <MainCard>
          <div className="py-16 text-center font-(family-name:--font-dm-sans) text-[14px] text-danger">
            Failed to load optimize data: {error.message}
          </div>
        </MainCard>
      </div>
    );
  }

  if (!fromProto || !toProto) {
    return (
      <div className="relative z-10">
        <PageHeader title="Optimize" icon={Zap} />
        <MainCard>
          <div className="py-16 text-center font-(family-name:--font-dm-sans) text-[14px] text-text-muted">
            No positions found for this wallet.
          </div>
        </MainCard>
      </div>
    );
  }

  return (
    <div className="relative z-10">
      <PageHeader title="Optimize" icon={Zap} />

      <MainCard>
        <Title3 text="Migrate Position" />

        <div className="mt-6 grid gap-5 items-start grid-cols-1 lg:grid-cols-[1fr_200px_1fr]">
          <FromCard
            fromProto={fromProto}
            isFromJuplend={isFromJuplend}
            pairs={juplendPairs}
            colAsset={colAsset}
            debtAsset={debtAsset}
            pair={pair}
            onFromChange={(p) => {
              setFromOverride(p);
              setColSym(null);
              setDebtSym(null);
              setPairId(null);
            }}
            onColChange={setColSym}
            onDebtChange={setDebtSym}
            onPairChange={setPairId}
            fromLTV={fromLTV}
            fromMaxLTV={fromMaxLTV}
            fromLiqThreshold={fromLiqThreshold}
            fromSupplyApy={fromSupplyApy}
            fromBorrowApy={fromBorrowApy}
          />

          <CenterColumn savings={monthlySavings} />

          <ToCard
            selected={toProtocol ?? Protocol.Kamino}
            excludeProtocol={fromProtocol}
            onSelect={setToOverride}
            market={toMarket}
            isLoading={marketLoading}
            fromCollateralSymbol={fromCollateralSymbol}
            fromDebtSymbol={fromDebtSymbol}
          />
        </div>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile
            icon={<TrendingUp size={16} className="text-accent" />}
            label="Borrow Rate"
            value={
              fromBorrowApy != null && toMarket?.borrowApy != null
                ? `${fromBorrowApy.toFixed(2)}% → ${toMarket.borrowApy.toFixed(2)}%`
                : "—"
            }
          />
          <StatTile
            icon={<ShieldCheck size={16} className="text-accent" />}
            label="Max LTV"
            value={
              fromMaxLTV != null && toMarket?.ltv != null
                ? `${fromMaxLTV.toFixed(1)}% → ${toMarket.ltv.toFixed(1)}%`
                : fromMaxLTV != null
                  ? `${fromMaxLTV.toFixed(1)}% → —`
                  : "—"
            }
          />
          <StatTile
            icon={<DollarSign size={16} className="text-accent" />}
            label="Annual Savings"
            value={
              monthlySavings > 0 ? `$${(monthlySavings * 12).toFixed(2)}` : "—"
            }
          />
        </div>

        {kaminoToJupLendBlocked && (
          <div className="mt-6 rounded-md border border-warn/30 bg-warn/10 px-4 py-3 flex items-start gap-2">
            <AlertTriangle
              size={16}
              strokeWidth={1.8}
              className="text-warn mt-0.5 shrink-0"
            />
            <div className="flex flex-col gap-0.5">
              <span className="font-(family-name:--font-dm-sans) text-[14.5px] font-bold text-warn">
                Kamino has blocked refinancing to Jupiter Lend at the program
                level, atomic migration is not possible.
              </span>
              <span className="font-(family-name:--font-dm-sans) text-[12.5px] font-semibold text-text-muted">
                You unfortunately can&apos;t do it from here. If you&apos;re a
                Kamino user, please ask them to unblock Jupiter Lend at the
                program level.
              </span>
            </div>
          </div>
        )}

        <div className="mt-10 flex flex-col items-end gap-2">
          <ActionButton
            disabled={!canMigrate}
            onClick={() => setModalOpen(true)}
            trailingIcon={<ArrowRight size={16} strokeWidth={2.5} />}
          >
            Migrate Position
          </ActionButton>
        </div>
      </MainCard>

      {modalOpen &&
        fromReady &&
        toMarket?.available &&
        toProtocol != null &&
        fromProtocol != null && (
          <RefinanceModal
            onMigrate={buildMigrateHandler({
              fromProtocol,
              toProtocol,
              pair:
                isFromJuplend && pair
                  ? {
                      id: pair.id,
                      collateralMint: pair.collateralMint,
                      collateralSymbol: pair.collateralSymbol,
                      collateralDecimals: pair.collateralDecimals,
                      collateralAmount: pair.collateralAmount,
                      collateralAmountStr: `${pair.collateralAmount} ${pair.collateralSymbol}`,
                      collateralValueUsd: `$${pair.collateralUsd.toFixed(2)}`,
                      collateralLogoUrl: pair.collateralLogoUrl,
                      debtMint: pair.debtMint,
                      debtSymbol: pair.debtSymbol,
                      debtDecimals: pair.debtDecimals,
                      debtAmount: pair.debtAmount,
                      debtAmountStr: `${pair.debtAmount} ${pair.debtSymbol}`,
                      debtValueUsd: `$${pair.debtUsd.toFixed(2)}`,
                      debtLogoUrl: pair.debtLogoUrl,
                      ltv: pair.ltv,
                      maxLTV: pair.maxLTV,
                      liqThreshold: pair.liqThreshold,
                      health: 0,
                      status: "Healthy",
                      netApy: 0,
                      supplyApy: pair.supplyApy,
                      borrowApy: pair.borrowApy,
                    }
                  : undefined,
              auxJupLendVaultId,
              fromCtx,
              toMarketMeta: toMarket.meta,
              userJupLendPositions,
              walletPublicKey: publicKey,
              signTransaction,
              connection,
            })}
            onConfirmed={() => {
              refetch({ noCache: true });
              if (publicKey) {
                void invalidatePositionsCache(publicKey.toBase58(), [
                  toProtocol,
                ]);
              }
            }}
            fromProto={
              {
                name: fromProto.name,
                maxLTV: fromMaxLTV,
                supplyApy: fromSupplyApy,
                borrowApy: fromBorrowApy,
              } satisfies RefinanceModalProto
            }
            toProto={
              {
                name: PROTOCOL_DISPLAY_NAME[toProtocol],
                maxLTV: toMarket.ltv ?? null,
                supplyApy: toMarket.supplyApy ?? null,
                borrowApy: toMarket.borrowApy ?? null,
              } satisfies RefinanceModalProto
            }
            initialCollateral={
              isFromJuplend && pair
                ? ({
                    symbol: pair.collateralSymbol,
                    amount: pair.collateralAmount,
                    usd: pair.collateralUsd,
                    logoUrl: pair.collateralLogoUrl,
                  } satisfies RefinanceModalAsset)
                : colAsset
                  ? ({
                      symbol: colAsset.symbol,
                      amount: colAsset.amount,
                      usd: colAsset.usd,
                      logoUrl: colAsset.logoUrl,
                    } satisfies RefinanceModalAsset)
                  : { symbol: "", amount: 0, usd: 0 }
            }
            initialDebt={
              isFromJuplend && pair
                ? ({
                    symbol: pair.debtSymbol,
                    amount: pair.debtAmount,
                    usd: pair.debtUsd,
                    logoUrl: pair.debtLogoUrl,
                  } satisfies RefinanceModalAsset)
                : debtAsset
                  ? ({
                      symbol: debtAsset.symbol,
                      amount: debtAsset.amount,
                      usd: debtAsset.usd,
                      logoUrl: debtAsset.logoUrl,
                    } satisfies RefinanceModalAsset)
                  : null
            }
            siblingDebts={
              !isFromJuplend && fromProto && debtAsset
                ? fromProto.debts
                    .filter(
                      (d) => d.symbol !== debtAsset.symbol && d.amount > 0,
                    )
                    .map((d) => ({
                      symbol: d.symbol,
                      amount: d.amount,
                      usd: d.usd,
                    }))
                : []
            }
            fromMaxLTV={fromMaxLTV}
            onClose={() => setModalOpen(false)}
          />
        )}
    </div>
  );
}

// ── From card ───────────────────────────────────────────────────────────

function FromCard({
  fromProto,
  isFromJuplend,
  pairs,
  colAsset,
  debtAsset,
  pair,
  onFromChange,
  onColChange,
  onDebtChange,
  onPairChange,
  fromLTV,
  fromMaxLTV,
  fromLiqThreshold,
  fromSupplyApy,
  fromBorrowApy,
}: {
  fromProto: OptimizeProtocol;
  isFromJuplend: boolean;
  pairs: OptimizeJuplendPair[];
  colAsset: OptimizeAsset | null;
  debtAsset: OptimizeAsset | null;
  pair: OptimizeJuplendPair | null;
  onFromChange: (p: Protocol) => void;
  onColChange: (sym: string) => void;
  onDebtChange: (sym: string) => void;
  onPairChange: (id: string) => void;
  fromLTV: number;
  fromMaxLTV: number | null;
  fromLiqThreshold: number | null;
  fromSupplyApy: number | null;
  fromBorrowApy: number | null;
}) {
  const empty =
    (isFromJuplend && pairs.length === 0) ||
    (!isFromJuplend &&
      fromProto.collaterals.length === 0 &&
      fromProto.debts.length === 0);

  return (
    <div className="space-y-5 relative rounded-lg border p-5 bg-white/2 border-border-base shadow-[0_4px_12px_rgba(0,0,0,0.18)]">
      <ProtocolPicker
        label="From Protocol"
        value={fromProto.protocol}
        onSelect={onFromChange}
      />

      {empty ? (
        <div className="rounded-md border border-border-base bg-surface-2 px-4 py-3 text-[12px] text-text-muted">
          No active position on {fromProto.name}.
        </div>
      ) : isFromJuplend ? (
        <PairDropdown
          label="Pair"
          value={pair?.id ?? ""}
          options={pairs}
          onChange={onPairChange}
        />
      ) : (
        <div className="flex gap-3">
          <AssetDropdown
            label="Collateral"
            value={colAsset?.symbol ?? null}
            options={fromProto.collaterals.map((c) => ({
              symbol: c.symbol,
              amount: c.amount,
              usd: c.usd,
              logoUrl: c.logoUrl,
            }))}
            onChange={onColChange}
          />
          <AssetDropdown
            label="Debt"
            value={debtAsset?.symbol ?? null}
            options={fromProto.debts.map((d) => ({
              symbol: d.symbol,
              amount: d.amount,
              usd: d.usd,
              logoUrl: d.logoUrl,
            }))}
            onChange={onDebtChange}
          />
        </div>
      )}

      <div className="flex flex-col">
        <MetricRow label="LTV" value={`${fromLTV.toFixed(1)}%`} />
        <div className="h-px bg-border-base" />
        <MetricRow
          label="Max LTV"
          value={fromMaxLTV != null ? `${fromMaxLTV.toFixed(1)}%` : "—"}
        />
        <div className="h-px bg-border-base" />
        <MetricRow
          label="Liq. Threshold"
          value={
            fromLiqThreshold != null ? `${fromLiqThreshold.toFixed(1)}%` : "—"
          }
        />
        <div className="h-px bg-border-base" />
        <MetricRow
          label="Supply Rate"
          value={fmtPct(fromSupplyApy)}
          highlight
        />
        <div className="h-px bg-border-base" />
        <MetricRow label="Borrow Rate" value={fmtPct(fromBorrowApy)} />
      </div>
    </div>
  );
}

// ── To card ─────────────────────────────────────────────────────────────

function ToCard({
  selected,
  excludeProtocol,
  onSelect,
  market,
  isLoading,
  fromCollateralSymbol,
  fromDebtSymbol,
}: {
  selected: Protocol;
  excludeProtocol: Protocol | null;
  onSelect: (p: Protocol) => void;
  market: MarketOption | undefined;
  isLoading: boolean;
  fromCollateralSymbol?: string;
  fromDebtSymbol?: string;
}) {
  const unavailable = market !== undefined && !market.available;
  const candidates = ALL_PROTOCOLS.filter((p) => p !== excludeProtocol);

  return (
    <div
      className={`space-y-5 relative rounded-lg border p-5 bg-white/2 shadow-[0_4px_12px_rgba(0,0,0,0.18)] ${
        unavailable ? "border-warn/30" : "border-border-base"
      }`}
    >
      <div className="space-y-1.5">
        <Title4 text="To Protocol" />
        <div className="flex flex-wrap gap-2">
          {candidates.map((p) => {
            const isActive = p === selected;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onSelect(p)}
                className="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer"
                style={{
                  background: isActive ? C.active : "transparent",
                  border: `1px solid ${isActive ? C.borderLit : C.border}`,
                  transition: "all 150ms ease",
                }}
              >
                <ProtocolIcon name={PROTOCOL_DISPLAY_NAME[p]} size={20} />
                <span
                  className="font-(family-name:--font-dm-sans) text-[13px] font-bold"
                  style={{ color: isActive ? C.text : C.textSec }}
                >
                  {PROTOCOL_DISPLAY_NAME[p]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2 animate-pulse">
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      )}

      {unavailable && (
        <div className="rounded-md border border-warn/30 bg-warn/10 px-4 py-3 flex items-start gap-2">
          <AlertTriangle
            size={14}
            strokeWidth={1.8}
            className="text-warn mt-0.5 shrink-0"
          />
          <div className="flex flex-col gap-0.5">
            <span className="font-(family-name:--font-dm-sans) text-[12.5px] font-bold text-warn">
              {fromCollateralSymbol && fromDebtSymbol
                ? `${fromCollateralSymbol} / ${fromDebtSymbol}`
                : "Pair"}{" "}
              not available on {PROTOCOL_DISPLAY_NAME[selected]}
            </span>
            {market?.reason && (
              <span className="font-(family-name:--font-dm-sans) text-[11.5px] font-semibold text-text-muted">
                {market.reason}
              </span>
            )}
          </div>
        </div>
      )}

      {market?.available && (
        <div className="flex flex-col">
          <MetricRow
            label="Max LTV"
            value={market.ltv != null ? `${market.ltv.toFixed(1)}%` : "—"}
          />
          <div className="h-px bg-border-base" />
          <MetricRow
            label="Liq. Threshold"
            value={
              market.liquidationThreshold != null
                ? `${market.liquidationThreshold.toFixed(1)}%`
                : "—"
            }
          />
          <div className="h-px bg-border-base" />
          <MetricRow
            label="Supply Rate"
            value={fmtPct(market.supplyApy)}
            highlight
          />
          <div className="h-px bg-border-base" />
          <MetricRow label="Borrow Rate" value={fmtPct(market.borrowApy)} />
        </div>
      )}
    </div>
  );
}

// ── Center column ───────────────────────────────────────────────────────

function CenterColumn({ savings }: { savings: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 pt-10">
      <div className="relative flex items-center justify-center w-14 h-14">
        <span className="absolute inset-0 rounded-full bg-accent/5" />
        <ArrowRight size={20} strokeWidth={2} className="text-accent" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <Title4 text="Est. Monthly Savings" />
        <span
          className="font-(family-name:--font-ibm-plex-mono) text-[32px] font-bold leading-none"
          style={{ color: savings > 0 ? C.accent : C.textMuted }}
        >
          ${savings.toFixed(2)}
        </span>
        <span className="font-(family-name:--font-dm-sans) text-[12px] font-semibold text-text-dim">
          saved / month
        </span>
      </div>
    </div>
  );
}

// ── Pickers ─────────────────────────────────────────────────────────────

function ProtocolPicker({
  label,
  value,
  onSelect,
}: {
  label: string;
  value: Protocol;
  onSelect: (p: Protocol) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative space-y-1.5">
      <Title4 text={label} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full flex items-center gap-2 px-3 h-10 rounded-md transition-colors cursor-pointer bg-surface-2 text-text-base"
      >
        <ProtocolIcon name={PROTOCOL_DISPLAY_NAME[value]} size={22} />
        <span className="font-(family-name:--font-dm-sans) text-[13px] font-semibold">
          {PROTOCOL_DISPLAY_NAME[value]}
        </span>
        <ChevronDown
          size={14}
          className={`ml-auto text-text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 rounded-md bg-surface-2 overflow-y-auto custom-scrollbar max-h-48 sm:max-h-60 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
          {ALL_PROTOCOLS.map((p) => {
            const isSelected = p === value;
            return (
              <button
                key={p}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(p);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 h-10 transition-colors cursor-pointer text-text-base ${
                  isSelected ? "bg-accent/6" : "bg-transparent hover:bg-white/3"
                }`}
              >
                <ProtocolIcon name={PROTOCOL_DISPLAY_NAME[p]} size={22} />
                <span className="font-(family-name:--font-dm-sans) text-[13px] font-medium">
                  {PROTOCOL_DISPLAY_NAME[p]}
                </span>
                {isSelected && (
                  <Check
                    size={14}
                    strokeWidth={2.5}
                    className="ml-auto text-accent"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PairDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: OptimizeJuplendPair[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((p) => p.id === value) ?? options[0];
  return (
    <div className="space-y-1.5 relative flex-1 min-w-0">
      <Title4 text={label} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full min-h-12 flex items-center gap-2.5 px-3 py-2 rounded-sm transition-colors cursor-pointer bg-surface-2 text-text-base"
      >
        {selected ? (
          <>
            <TokenPairIcon
              collateralSymbol={selected.collateralSymbol}
              debtSymbol={selected.debtSymbol}
              collateralLogoUrl={selected.collateralLogoUrl}
              debtLogoUrl={selected.debtLogoUrl}
              size={22}
            />
            <div className="flex flex-col gap-y-0.5 items-start min-w-0">
              <span className="font-(family-name:--font-ibm-plex-mono) text-[13px] font-semibold leading-tight">
                {selected.collateralSymbol} / {selected.debtSymbol}
              </span>
              <span className="font-(family-name:--font-ibm-plex-mono) text-[10px] leading-tight text-text-muted">
                {selected.collateralAmount.toFixed(2)}{" "}
                {selected.collateralSymbol} / {selected.debtAmount.toFixed(2)}{" "}
                {selected.debtSymbol}
              </span>
            </div>
          </>
        ) : (
          <span className="font-(family-name:--font-dm-sans) text-[12px] text-text-muted">
            Select pair…
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-0.5 absolute left-0 right-0 z-40 rounded-sm bg-surface-2 overflow-y-auto custom-scrollbar max-h-48 sm:max-h-60 shadow-[0_10px_28px_rgba(0,0,0,0.40)]">
          {options.map((opt) => {
            const isSelected = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors cursor-pointer text-text-base ${
                  isSelected ? "bg-accent/6" : "bg-transparent hover:bg-white/3"
                }`}
              >
                <TokenPairIcon
                  collateralSymbol={opt.collateralSymbol}
                  debtSymbol={opt.debtSymbol}
                  collateralLogoUrl={opt.collateralLogoUrl}
                  debtLogoUrl={opt.debtLogoUrl}
                  size={22}
                />
                <div className="flex flex-col items-start min-w-0">
                  <span className="font-(family-name:--font-ibm-plex-mono) text-[12px] font-semibold leading-tight">
                    {opt.collateralSymbol} / {opt.debtSymbol}
                  </span>
                  <span className="font-(family-name:--font-ibm-plex-mono) text-[10px] leading-tight text-text-muted">
                    {opt.collateralAmount.toFixed(2)} {opt.collateralSymbol} /{" "}
                    {opt.debtAmount.toFixed(2)} {opt.debtSymbol}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Stat tile ───────────────────────────────────────────────────────────

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md bg-accent/3 px-5 py-4 flex items-center gap-3.5">
      <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 bg-accent/6">
        {icon}
      </div>
      <div className="flex flex-col min-w-0">
        <Title4 text={label} />
        <span className="font-(family-name:--font-ibm-plex-mono) text-[15px] font-bold mt-0.5 text-accent">
          {value}
        </span>
      </div>
    </div>
  );
}
