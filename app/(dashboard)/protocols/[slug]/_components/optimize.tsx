"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  DollarSign,
  AlertTriangle,
} from "lucide-react";
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
} from "@/app/(dashboard)/optimize/_components/refinance-modal";
import { useMarketComparison, useJupLendUserPositions } from "@/src/lib/api";
import { invalidatePositionsCache } from "@/src/lib/api/invalidate";
import { Skeleton } from "@/src/components/ui/skeleton";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { buildMigrateHandler } from "@/src/lib/tx/refinance-dispatcher";
import type { FromPositionContext } from "@/src/lib/tx/refinance-dispatcher";
import type { MarketOption } from "@/src/lib/api";
import type {
  CollateralAsset,
  DebtAsset,
  JuplendPairPosition,
  ProtocolDetail,
} from "../page";
import { C } from "@/src/lib/theme";

const PROTOCOL_DISPLAY: Record<Protocol, string> = {
  [Protocol.Kamino]: "Kamino",
  [Protocol.Drift]: "Drift",
  [Protocol.Save]: "Save",
  [Protocol.JupLend]: "Juplend",
};

function fmtPct(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function parseUsd(s: string): number {
  return parseFloat(s.replace(/[^0-9.\-]/g, "")) || 0;
}

function parseLeadingNumber(s: string): number {
  const m = s.match(/-?\d*\.?\d+/);
  return m ? parseFloat(m[0]) : 0;
}

function buildSourceMeta(
  protocol: Protocol,
  colAsset: CollateralAsset,
  debtAsset: DebtAsset,
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

export function OptimizeTab({
  protocol,
  refetch,
}: {
  protocol: ProtocolDetail;
  refetch?: (opts?: { noCache?: boolean }) => void;
}) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const isJuplend = protocol.slug === "juplend";

  // ── From selection: collateral + debt mints ──────────────────────────
  const [colSym, setColSym] = useState<string>(
    protocol.collateralAssets[0]?.symbol ?? "",
  );
  const [debtSym, setDebtSym] = useState<string>(
    protocol.debtAssets[0]?.symbol ?? "",
  );
  const [pairId, setPairId] = useState<string>(protocol.pairs[0]?.id ?? "");
  const [toProtocol, setToProtocol] = useState<Protocol>(() => {
    // Default to a different protocol than the current. Drift is hidden in
    // the UI for now; the data layer still supports it.
    const order = [Protocol.Kamino, Protocol.Save, Protocol.JupLend];
    return (
      order.find((p) => PROTOCOL_DISPLAY[p] !== protocol.name) ??
      Protocol.Kamino
    );
  });
  const [modalOpen, setModalOpen] = useState(false);

  const colAsset =
    protocol.collateralAssets.find((a) => a.symbol === colSym) ??
    protocol.collateralAssets[0];
  const debtAsset =
    protocol.debtAssets.find((a) => a.symbol === debtSym) ??
    protocol.debtAssets[0];
  const pair = protocol.pairs.find((p) => p.id === pairId) ?? protocol.pairs[0];

  const fromCollateralMint = isJuplend
    ? (pair?.collateralMint ?? null)
    : (colAsset?.mint ?? null);
  const fromDebtMint = isJuplend
    ? (pair?.debtMint ?? null)
    : (debtAsset?.mint ?? null);

  const fromCollateralSymbol = isJuplend
    ? pair?.collateralSymbol
    : colAsset?.symbol;
  const fromDebtSymbol = isJuplend ? pair?.debtSymbol : debtAsset?.symbol;

  const debtUsd = isJuplend
    ? pair
      ? parseUsd(pair.debtValueUsd)
      : 0
    : (debtAsset?.valueNum ?? 0);

  const fromLTV = isJuplend ? (pair?.ltv ?? 0) : protocol.currentLTV;
  const fromMaxLTV = isJuplend ? (pair?.maxLTV ?? null) : protocol.maxLTV;
  const fromLiqThreshold = isJuplend
    ? (pair?.liqThreshold ?? null)
    : protocol.liqThreshold;

  // Source supply/borrow APRs from this protocol's actual position.
  const fromSupplyApy = isJuplend
    ? (pair?.supplyApy ?? null)
    : colAsset
      ? parseFloat(colAsset.supplyAPY.replace(/[^0-9.\-]/g, ""))
      : null;
  const fromBorrowApy = isJuplend
    ? (pair?.borrowApy ?? null)
    : (debtAsset?.borrowAPR ?? null);

  // ── To-side: live market comparison ─────────────────────────────────
  const { data: comparison, isLoading } = useMarketComparison(
    fromCollateralMint,
    fromDebtMint,
  );

  const toMarket: MarketOption | undefined = useMemo(
    () => comparison?.markets.find((m) => m.protocol === toProtocol),
    [comparison, toProtocol],
  );

  // JupLend's vaultId for this collateral/debt pair, if a JupLend market
  // exists. Used by flash-loan-only flows (e.g. Kamino to Save) to borrow
  // the JupLend vault's LUT without making JupLend a participant. Falls
  // back to undefined when no JupLend pair exists, the prepare layer
  // tolerates that gracefully.
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

  const fromCtx: FromPositionContext | undefined = useMemo(() => {
    if (isJuplend) return undefined;
    if (!colAsset || !debtAsset) return undefined;
    return {
      collateralMint: colAsset.mint,
      collateralDecimals: colAsset.decimals,
      collateralSymbol: colAsset.symbol,
      debtMint: debtAsset.mint,
      debtDecimals: debtAsset.decimals,
      debtSymbol: debtAsset.symbol,
      meta: buildSourceMeta(protocol.protocol, colAsset, debtAsset),
    };
  }, [isJuplend, colAsset, debtAsset, protocol.protocol]);

  // ── Savings math ─────────────────────────────────────────────────────
  const monthlySavingsUsd = useMemo(() => {
    if (!toMarket?.available) return 0;
    if (toMarket.borrowApy == null || fromBorrowApy == null) return 0;
    const delta = fromBorrowApy - toMarket.borrowApy;
    if (delta <= 0) return 0;
    return ((delta / 100) * debtUsd) / 12;
  }, [toMarket, fromBorrowApy, debtUsd]);

  // ── Migrate enable gating ────────────────────────────────────────────
  const fromReady = isJuplend
    ? Boolean(pair && pair.collateralMint && pair.debtMint)
    : Boolean(colAsset && debtAsset);

  const kaminoToJupLendBlocked =
    protocol.protocol === Protocol.Kamino && toProtocol === Protocol.JupLend;

  const canMigrate =
    fromReady &&
    Boolean(toMarket?.available) &&
    PROTOCOL_DISPLAY[toProtocol] !== protocol.name &&
    !kaminoToJupLendBlocked;

  return (
    <div>
      <Title3 text="Migrate Position" />

      <div className="mt-4 grid gap-5 items-start grid-cols-[1fr_200px_1fr]">
        <FromCard
          protocol={protocol}
          isJuplend={isJuplend}
          collateralAssets={protocol.collateralAssets}
          debtAssets={protocol.debtAssets}
          pairs={protocol.pairs}
          colSym={colSym}
          debtSym={debtSym}
          pairId={pairId}
          onColChange={setColSym}
          onDebtChange={setDebtSym}
          onPairChange={setPairId}
          fromLTV={fromLTV}
          fromMaxLTV={fromMaxLTV}
          fromLiqThreshold={fromLiqThreshold}
          fromSupplyApy={fromSupplyApy}
          fromBorrowApy={fromBorrowApy}
        />

        <CenterColumn savings={monthlySavingsUsd} />

        <ToCard
          selected={toProtocol}
          onSelect={setToProtocol}
          excludeName={protocol.name}
          market={toMarket}
          isLoading={isLoading}
          fromCollateralSymbol={fromCollateralSymbol}
          fromDebtSymbol={fromDebtSymbol}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
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
            monthlySavingsUsd > 0
              ? `$${(monthlySavingsUsd * 12).toFixed(2)}`
              : "—"
          }
        />
      </div>

      {kaminoToJupLendBlocked && (
        <div className="mt-4 rounded-md border border-warn/30 bg-warn/10 px-4 py-3 flex items-start gap-2">
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

      <div className="mt-2 flex flex-col items-end gap-2">
        <ActionButton
          disabled={!canMigrate}
          onClick={() => setModalOpen(true)}
          trailingIcon={<ArrowRight size={16} strokeWidth={2.5} />}
        >
          Migrate Position
        </ActionButton>
      </div>

      {modalOpen && fromReady && toMarket?.available && (
        <RefinanceModal
          onMigrate={buildMigrateHandler({
            fromProtocol: protocol.protocol,
            toProtocol,
            pair: isJuplend ? pair : undefined,
            auxJupLendVaultId,
            fromCtx,
            toMarketMeta: toMarket.meta,
            userJupLendPositions,
            walletPublicKey: publicKey,
            signTransaction,
            connection,
          })}
          onConfirmed={() => {
            // Source protocol: refetch with noCache repopulates its server
            // cache as a side effect, so no separate invalidate needed.
            // For destination protocol, we're not on its page, so drop its
            // cache entry to force a fresh fetch when something else asks.
            refetch?.({ noCache: true });
            if (publicKey) {
              void invalidatePositionsCache(publicKey.toBase58(), [toProtocol]);
            }
          }}
          fromProto={
            {
              name: protocol.name,
              maxLTV: fromMaxLTV,
              supplyApy: fromSupplyApy,
              borrowApy: fromBorrowApy,
            } satisfies RefinanceModalProto
          }
          toProto={
            {
              name: PROTOCOL_DISPLAY[toProtocol],
              maxLTV: toMarket.ltv ?? null,
              supplyApy: toMarket.supplyApy ?? null,
              borrowApy: toMarket.borrowApy ?? null,
            } satisfies RefinanceModalProto
          }
          initialCollateral={
            isJuplend && pair
              ? ({
                  symbol: pair.collateralSymbol,
                  amount: parseLeadingNumber(pair.collateralAmountStr),
                  usd: parseUsd(pair.collateralValueUsd),
                  logoUrl: pair.collateralLogoUrl,
                } satisfies RefinanceModalAsset)
              : colAsset
                ? ({
                    symbol: colAsset.symbol,
                    amount: colAsset.balance,
                    usd: colAsset.valueNum,
                    logoUrl: colAsset.logoUrl,
                  } satisfies RefinanceModalAsset)
                : { symbol: "", amount: 0, usd: 0 }
          }
          initialDebt={
            isJuplend && pair
              ? ({
                  symbol: pair.debtSymbol,
                  amount: parseLeadingNumber(pair.debtAmountStr),
                  usd: parseUsd(pair.debtValueUsd),
                  logoUrl: pair.debtLogoUrl,
                } satisfies RefinanceModalAsset)
              : debtAsset
                ? ({
                    symbol: debtAsset.symbol,
                    amount: debtAsset.borrowed,
                    usd: debtAsset.valueNum,
                    logoUrl: debtAsset.logoUrl,
                  } satisfies RefinanceModalAsset)
                : null
          }
          siblingDebts={
            !isJuplend && debtAsset
              ? protocol.debtAssets
                  .filter(
                    (d) => d.symbol !== debtAsset.symbol && d.borrowed > 0,
                  )
                  .map((d) => ({
                    symbol: d.symbol,
                    amount: d.borrowed,
                    usd: d.valueNum,
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

// ── From card ────────────────────────────────────────────────────────────

function FromCard({
  protocol,
  isJuplend,
  collateralAssets,
  debtAssets,
  pairs,
  colSym,
  debtSym,
  pairId,
  onColChange,
  onDebtChange,
  onPairChange,
  fromLTV,
  fromMaxLTV,
  fromLiqThreshold,
  fromSupplyApy,
  fromBorrowApy,
}: {
  protocol: ProtocolDetail;
  isJuplend: boolean;
  collateralAssets: CollateralAsset[];
  debtAssets: DebtAsset[];
  pairs: JuplendPairPosition[];
  colSym: string;
  debtSym: string;
  pairId: string;
  onColChange: (v: string) => void;
  onDebtChange: (v: string) => void;
  onPairChange: (v: string) => void;
  fromLTV: number;
  fromMaxLTV: number | null;
  fromLiqThreshold: number | null;
  fromSupplyApy: number | null;
  fromBorrowApy: number | null;
}) {
  const empty =
    (isJuplend && pairs.length === 0) ||
    (!isJuplend && collateralAssets.length === 0 && debtAssets.length === 0);

  return (
    <div className="space-y-5 relative rounded-lg border p-5 bg-white/2 border-border-base shadow-[0_4px_12px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-3">
        <ProtocolIcon name={protocol.name} size={28} />
        <div className="flex flex-col">
          <Title4 text="From Protocol" />
          <span className="font-(family-name:--font-dm-sans) text-[15px] font-bold text-text-base">
            {protocol.name}
          </span>
        </div>
      </div>

      {empty ? (
        <div className="rounded-md border border-border-base bg-surface-2 px-4 py-3 text-[12px] text-text-muted">
          No active position on {protocol.name}.
        </div>
      ) : isJuplend ? (
        <PairDropdown
          label="Pair"
          value={pairId}
          options={pairs}
          onChange={onPairChange}
        />
      ) : (
        <div className="flex gap-3">
          <AssetDropdown
            label="Collateral"
            value={colSym}
            options={collateralAssets.map((c) => ({
              symbol: c.symbol,
              amount: c.balance,
              usd: c.valueNum,
              logoUrl: c.logoUrl,
            }))}
            onChange={onColChange}
          />
          <AssetDropdown
            label="Debt"
            value={debtSym}
            options={debtAssets.map((d) => ({
              symbol: d.symbol,
              amount: d.borrowed,
              usd: d.valueNum,
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
          value={fromSupplyApy != null ? fmtPct(fromSupplyApy) : "—"}
          highlight
        />
        <div className="h-px bg-border-base" />
        <MetricRow
          label="Borrow Rate"
          value={fromBorrowApy != null ? fmtPct(fromBorrowApy) : "—"}
        />
      </div>
    </div>
  );
}

// ── To card ──────────────────────────────────────────────────────────────

function ToCard({
  selected,
  onSelect,
  excludeName,
  market,
  isLoading,
  fromCollateralSymbol,
  fromDebtSymbol,
}: {
  selected: Protocol;
  onSelect: (p: Protocol) => void;
  excludeName: string;
  market: MarketOption | undefined;
  isLoading: boolean;
  fromCollateralSymbol?: string;
  fromDebtSymbol?: string;
}) {
  const protocols = [Protocol.Kamino, Protocol.Save, Protocol.JupLend].filter(
    (p) => PROTOCOL_DISPLAY[p] !== excludeName,
  );

  const unavailable = market !== undefined && !market.available;

  return (
    <div
      className={`space-y-5 relative rounded-lg border p-5 bg-white/2 shadow-[0_4px_12px_rgba(0,0,0,0.18)] ${
        unavailable ? "border-warn/30" : "border-border-base"
      }`}
    >
      <div className="mb-1">
        <Title4 text="To Protocol" />
      </div>
      <div className="flex flex-wrap gap-2">
        {protocols.map((p) => {
          const isActive = p === selected;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onSelect(p)}
              className="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer"
              style={{
                background: isActive ? C.active : "transparent",
                transition: "all 150ms ease",
              }}
            >
              <ProtocolIcon name={PROTOCOL_DISPLAY[p]} size={20} />
              <span
                className="font-(family-name:--font-dm-sans) text-[13px] font-bold"
                style={{ color: isActive ? C.text : C.textSec }}
              >
                {PROTOCOL_DISPLAY[p]}
              </span>
            </button>
          );
        })}
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
              not available on {PROTOCOL_DISPLAY[selected]}
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
            value={market.supplyApy != null ? fmtPct(market.supplyApy) : "—"}
            highlight
          />
          <div className="h-px bg-border-base" />
          <MetricRow
            label="Borrow Rate"
            value={market.borrowApy != null ? fmtPct(market.borrowApy) : "—"}
          />
        </div>
      )}
    </div>
  );
}

// ── Center column ────────────────────────────────────────────────────────

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

// ── Sub-components ──────────────────────────────────────────────────────

function PairDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: JuplendPairPosition[];
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
                {selected.collateralAmountStr} / {selected.debtAmountStr}
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
        <div className="space-y-0.5 absolute left-0 right-0 z-40 rounded-sm bg-surface-2 overflow-hidden shadow-[0_10px_28px_rgba(0,0,0,0.40)]">
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
                    {opt.collateralAmountStr} / {opt.debtAmountStr}
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
