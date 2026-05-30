"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PlusSquare,
  Check,
  ChevronDown,
  HelpCircle,
  X,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/src/components/page-header";
import { MainCard } from "@/src/components/main-card";
import { ProtocolIcon, TokenIcon } from "@/src/components/icons/token-icons";
import { ActionButton } from "@/src/components/ui/action-button";
import { SegmentedTabs } from "@/src/components/ui/segmented-tabs";
import { Title4 } from "@/src/components/ui/title-4";
import { Title3 } from "@/src/components/ui/title-3";
import { Skeleton } from "@/src/components/ui/skeleton";
import { CreatePositionModal } from "./_components/create-position-modal";
import { Protocol } from "@/app/types/main";
import {
  PROTOCOL_DISPLAY_NAME,
  useMarketComparison,
  useTokenList,
  useTokenPrices,
} from "@/src/lib/api";
import type { MarketOption } from "@/src/lib/api";
import { CURATED_TOKENS, type CuratedToken } from "@/src/lib/tokens";
import { isProtocolVisible } from "@/src/lib/protocol-visibility";
import { useConnectedWallet } from "@/src/components/wallet/useConnectedWallet";
import { ConnectWalletGate } from "@/src/components/wallet/connect-wallet";

// A curated entry enriched with live Jupiter metadata (mint, decimals, name,
// logoUrl). Resolved at render time via useTokenList.
interface ResolvedToken extends CuratedToken {
  mint: string;
  decimals: number;
  name: string;
  logoUrl?: string;
}

const STRATEGIES = [
  "Highest Yield",
  "Lowest Borrow Rate",
  "Lowest Risk",
] as const;
type Strategy = (typeof STRATEGIES)[number];

function netApyOf(m: MarketOption): number {
  if (m.netApy != null) return m.netApy;
  if (m.supplyApy != null && m.borrowApy != null)
    return m.supplyApy - m.borrowApy;
  return m.supplyApy ?? 0;
}

function sortMarkets(
  markets: MarketOption[],
  strategy: Strategy,
): MarketOption[] {
  // Available first, sorted by strategy; unavailable last, untouched.
  const available = markets.filter((m) => m.available);
  const unavailable = markets.filter((m) => !m.available);
  const sorted = [...available];
  switch (strategy) {
    case "Highest Yield":
      sorted.sort((a, b) => netApyOf(b) - netApyOf(a));
      break;
    case "Lowest Borrow Rate":
      sorted.sort(
        (a, b) =>
          (a.borrowApy ?? Number.POSITIVE_INFINITY) -
          (b.borrowApy ?? Number.POSITIVE_INFINITY),
      );
      break;
    case "Lowest Risk":
      sorted.sort((a, b) => (b.ltv ?? 0) - (a.ltv ?? 0));
      break;
  }
  return [...sorted, ...unavailable];
}

function getNetMetric(m: MarketOption, strategy: Strategy): string {
  switch (strategy) {
    case "Highest Yield":
      return `${netApyOf(m).toFixed(2)}% Net`;
    case "Lowest Borrow Rate":
      return m.borrowApy != null ? `${m.borrowApy.toFixed(2)}% APR` : "—";
    case "Lowest Risk":
      return m.ltv != null ? `${m.ltv.toFixed(0)}% LTV` : "—";
  }
}

function getTooltipText(
  rank: number,
  strategy: Strategy,
  collateral: string,
  debt: string,
): string {
  const ordinal =
    rank === 1 ? "#1" : rank === 2 ? "#2" : rank === 3 ? "#3" : `#${rank}`;
  switch (strategy) {
    case "Highest Yield":
      return `Ranked ${ordinal} for highest net yield on ${collateral} → ${debt}.`;
    case "Lowest Borrow Rate":
      return `Ranked ${ordinal} for lowest borrow APR among supported protocols.`;
    case "Lowest Risk":
      return `Ranked ${ordinal} for highest supported max LTV.`;
  }
}

function useClickOutside<T extends HTMLElement>(callback: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) callback();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [callback]);
  return ref;
}

function TokenDropdown({
  label,
  selectedMint,
  onSelect,
  onClear,
  tokens,
}: {
  label: string;
  selectedMint: string | null;
  onSelect: (mint: string) => void;
  onClear?: () => void;
  tokens: ResolvedToken[];
}) {
  const [open, setOpen] = useState(false);
  const [clearHovered, setClearHovered] = useState(false);
  const closeDropdown = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(closeDropdown);
  const token = selectedMint
    ? (tokens.find((t) => t.mint === selectedMint) ?? null)
    : null;
  const showClear = !!onClear && !!token;

  return (
    <div className="flex-1 w-full sm:w-1/2 relative" ref={ref}>
      <div className="mb-2">
        <Title4 text={label} />
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-3 w-full px-5 py-5 rounded-lg cursor-pointer border bg-white/2 transition-colors ${open ? "border-[#1E3048]" : "border-border-base"}`}
      >
        {token ? (
          <>
            <TokenIcon
              symbol={token.symbol}
              logoUrl={token.logoUrl}
              size={32}
            />
            <span className="text-[15px] font-medium text-text-base">
              {token.symbol}
            </span>
          </>
        ) : (
          <span className="text-[15px] font-semibold text-text-muted">
            Select Asset...
          </span>
        )}

        <div className="ml-auto relative w-6 h-6 flex items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            {showClear ? (
              <motion.div
                key="clear"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                className={`absolute inset-0 flex items-center justify-center rounded-full cursor-pointer transition-colors ${clearHovered ? "bg-white/2" : "bg-transparent"}`}
                onMouseEnter={() => setClearHovered(true)}
                onMouseLeave={() => setClearHovered(false)}
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                  setOpen(false);
                  setClearHovered(false);
                }}
              >
                <X
                  size={14}
                  strokeWidth={2}
                  className={`transition-colors ${clearHovered ? "text-text-dim" : "text-text-muted"}`}
                />
              </motion.div>
            ) : (
              <motion.div
                key="chevron"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1, rotate: open ? 180 : 0 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <ChevronDown size={15} className="text-text-muted" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-300 overflow-y-auto custom-scrollbar max-h-72 mt-1.5 w-full rounded-md border border-border-base bg-[linear-gradient(180deg,var(--color-surface-1)_0%,var(--color-surface-2)_100%)] shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)]"
          >
            {tokens.map((t) => (
              <TokenDropdownRow
                key={t.mint}
                token={t}
                isSelected={t.mint === selectedMint}
                onSelect={() => {
                  onSelect(t.mint);
                  setOpen(false);
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TokenDropdownRow({
  token,
  isSelected,
  onSelect,
}: {
  token: ResolvedToken;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const bgClass = isSelected
    ? "bg-accent/6"
    : hovered
      ? "bg-white/4"
      : "bg-transparent";

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`flex items-center gap-3 w-full px-3.5 py-3 text-left cursor-pointer border-b border-border-base transition-colors ${bgClass}`}
    >
      <TokenIcon symbol={token.symbol} logoUrl={token.logoUrl} size={28} />
      <div className="flex flex-col min-w-0">
        <span className="text-[12.5px] font-bold text-text-base">
          {token.symbol}
        </span>
        <span className="text-[10.5px] font-semibold text-text-muted">
          {token.name}
        </span>
      </div>
      {isSelected && (
        <Check size={13} strokeWidth={2.5} className="ml-auto text-accent" />
      )}
    </button>
  );
}

function StrategySelector({
  selected,
  onSelect,
  collateralSelected,
  debtSelected,
}: {
  selected: Strategy | null;
  onSelect: (s: Strategy) => void;
  collateralSelected: boolean;
  debtSelected: boolean;
}) {
  const noneSelected = !collateralSelected;
  const onlyCollateral = collateralSelected && !debtSelected;

  function isDisabled(s: Strategy): boolean {
    if (noneSelected) return true;
    if (onlyCollateral && s !== "Highest Yield") return true;
    return false;
  }

  return (
    <div className="space-y-2">
      <Title4 text="Select Strategy" />
      <SegmentedTabs
        tabs={STRATEGIES.map((s) => ({
          value: s,
          label: s,
          disabled: isDisabled(s),
        }))}
        value={selected}
        onChange={onSelect}
      />
    </div>
  );
}

function RankingTooltip({ text, visible }: { text: string; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.18 }}
          className="absolute right-0 top-full mt-2 z-50 w-64 rounded-md border border-[#1E3048] bg-surface-2 px-3.5 py-3 shadow-[0_8px_20px_rgba(0,0,0,0.4)]"
        >
          <p className="text-[11.5px] leading-relaxed text-text-dim">{text}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Visible-on-this-page protocols, in canonical order. Used to render
// disabled placeholder rows before the user picks a collateral asset.
const VISIBLE_PROTOCOLS: Protocol[] = [
  Protocol.Kamino,
  Protocol.Save,
  Protocol.JupLend,
  Protocol.Drift,
].filter(isProtocolVisible);

function PlaceholderMarketCard({ protocol }: { protocol: Protocol }) {
  const protocolName = PROTOCOL_DISPLAY_NAME[protocol];
  return (
    <div
      aria-disabled="true"
      className="w-full rounded-lg border border-border-base bg-white/2 px-5 py-4 opacity-50 cursor-not-allowed"
    >
      <div className="flex items-center gap-3">
        <ProtocolIcon name={protocolName} size={32} />
        <span className="text-[14px] font-medium text-text-muted">
          {protocolName}
        </span>
        <span className="ml-auto font-(family-name:--font-dm-sans) text-[11.5px] font-semibold text-text-faint">
          Pick assets to compare
        </span>
      </div>
    </div>
  );
}

function MarketRankingCard({
  market,
  rank,
  isSelected,
  isAvailable,
  strategy,
  collateral,
  debt,
  onClick,
}: {
  market: MarketOption;
  rank: number;
  isSelected: boolean;
  isAvailable: boolean;
  strategy: Strategy;
  collateral: string;
  debt: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const isFirst = rank === 1 && isAvailable;
  const protocolName = PROTOCOL_DISPLAY_NAME[market.protocol];

  if (!isAvailable) {
    return (
      <div
        className="w-full rounded-lg border border-border-base bg-white/2 px-5 py-4 opacity-60"
        aria-disabled="true"
      >
        <div className="flex items-center gap-3">
          <ProtocolIcon name={protocolName} size={32} />
          <span className="text-[14px] font-medium text-text-muted">
            {protocolName}
          </span>
          <div className="ml-auto flex items-center gap-2 px-2.5 py-1 rounded-md bg-warn/10 border border-warn/22">
            <AlertTriangle size={12} className="text-warn" />
            <span className="text-[11px] font-semibold text-warn">
              {market.reason ?? "Not available"}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const netMetric = getNetMetric(market, strategy);
  const tooltipText = getTooltipText(rank, strategy, collateral, debt);

  const bgClass = isSelected
    ? "bg-accent/4"
    : hovered
      ? "bg-surface-2"
      : "bg-white/2";

  const borderClass = isSelected
    ? "border-accent/22"
    : hovered
      ? "border-[#1E3048]"
      : "border-border-base";

  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="relative"
    >
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`w-full rounded-lg border px-5 py-4 text-left cursor-pointer transition-colors ${bgClass} ${borderClass}`}
      >
        <div className="flex items-center gap-3 mb-3">
          <ProtocolIcon name={protocolName} size={32} />
          <span className="text-[14px] font-medium text-text-base">
            {protocolName}
          </span>

          {isFirst && (
            <span className="text-[10px] font-semibold tracking-[0.06em] px-2 py-0.5 text-accent bg-accent/6 border-accent/22">
              Recommended
            </span>
          )}

          {isSelected && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-5 h-5 rounded-full flex items-center justify-center bg-accent"
            >
              <Check size={11} strokeWidth={3} color="#fff" />
            </motion.div>
          )}

          <div className="ml-auto flex items-center gap-2.5 relative">
            <span className="font-(family-name:--font-ibm-plex-mono) text-[13px] font-semibold text-text-dim">
              {netMetric}
            </span>
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center cursor-help bg-white/8 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setTooltipOpen((o) => !o);
              }}
              onMouseEnter={() => setTooltipOpen(true)}
              onMouseLeave={() => setTooltipOpen(false)}
            >
              <HelpCircle
                size={11}
                strokeWidth={2}
                className="text-text-muted"
              />
            </div>
            <RankingTooltip text={tooltipText} visible={tooltipOpen} />
          </div>
        </div>

        <div className="flex items-center gap-5 flex-wrap">
          <MetricPill
            label="Supply"
            value={
              market.supplyApy != null ? `${market.supplyApy.toFixed(2)}%` : "—"
            }
            toneClass="text-accent"
          />
          <MetricPill
            label="Borrow"
            value={
              market.borrowApy != null ? `${market.borrowApy.toFixed(2)}%` : "—"
            }
            toneClass="text-danger"
          />
          <MetricPill
            label="Max LTV"
            value={market.ltv != null ? `${market.ltv.toFixed(1)}%` : "—"}
            toneClass="text-text-dim"
          />
        </div>
      </button>
    </motion.div>
  );
}

function MetricPill({
  label,
  value,
  toneClass,
}: {
  label: string;
  value: string;
  toneClass: string;
}) {
  return (
    <span className="font-(family-name:--font-dm-sans) text-[11.5px] text-text-muted">
      {label}{" "}
      <span
        className={`font-(family-name:--font-ibm-plex-mono) font-medium ${toneClass}`}
      >
        {value}
      </span>
    </span>
  );
}

const fadeVariants = {
  initial: { opacity: 0, height: 0 },
  animate: {
    opacity: 1,
    height: "auto",
    transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const },
  },
};

export default function CreatePositionPage() {
  const { isConnected, isInitializing } = useConnectedWallet();
  const [collateralMint, setCollateralMint] = useState<string | null>(null);
  const [debtMint, setDebtMint] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol | null>(
    null,
  );
  const [modalOpen, setModalOpen] = useState(false);

  const collateralSelected = collateralMint !== null;
  const debtSelected = debtMint !== null;

  const { bySymbol } = useTokenList();

  // Resolve curated symbols to live Jupiter metadata. Tokens not yet in the
  // verified list are dropped from the picker.
  const resolvedTokens: ResolvedToken[] = useMemo(() => {
    const out: ResolvedToken[] = [];
    for (const c of CURATED_TOKENS) {
      const meta = bySymbol.get(c.symbol);
      if (!meta) continue;
      out.push({
        ...c,
        mint: meta.mint,
        decimals: meta.decimals,
        name: meta.name,
        logoUrl: meta.logoUrl,
      });
    }
    return out;
  }, [bySymbol]);

  const tokenByMint = useMemo(() => {
    const m = new Map<string, ResolvedToken>();
    for (const t of resolvedTokens) m.set(t.mint, t);
    return m;
  }, [resolvedTokens]);

  const collateralToken = collateralMint
    ? (tokenByMint.get(collateralMint) ?? null)
    : null;
  const debtToken = debtMint ? (tokenByMint.get(debtMint) ?? null) : null;

  const { prices } = useTokenPrices([collateralMint, debtMint]);
  const collateralPrice = collateralMint
    ? (prices.get(collateralMint) ?? null)
    : null;
  const debtPrice = debtMint ? (prices.get(debtMint) ?? null) : null;

  const { data: comparison, isLoading } = useMarketComparison(
    collateralMint,
    debtMint,
  );

  const sortedMarkets = useMemo(() => {
    // Drift is hidden from the comparison list at the render layer; the
    // backend still returns it.
    const visible = (comparison?.markets ?? []).filter((m) =>
      isProtocolVisible(m.protocol),
    );
    if (!comparison || !strategy) return visible;
    return sortMarkets(visible, strategy);
  }, [comparison, strategy]);

  const selectedMarket = useMemo(
    () => sortedMarkets.find((m) => m.protocol === selectedProtocol) ?? null,
    [sortedMarkets, selectedProtocol],
  );

  const canCreate =
    collateralSelected &&
    selectedProtocol !== null &&
    Boolean(selectedMarket?.available);

  const handleCollateralSelect = (mint: string) => {
    setCollateralMint(mint);
    setSelectedProtocol(null);
    if (!strategy) setStrategy("Highest Yield");
  };

  const handleDebtSelect = (mint: string) => {
    setDebtMint(mint);
    setSelectedProtocol(null);
    if (!strategy) setStrategy("Highest Yield");
  };

  const handleDebtClear = () => {
    setDebtMint(null);
    setSelectedProtocol(null);
    setStrategy("Highest Yield");
  };

  const handleStrategySelect = (s: Strategy) => {
    setStrategy(s);
    setSelectedProtocol(null);
  };

  // While the wallet adapter is still resolving (auto-connect, hydration),
  // render a quiet placeholder instead of flashing the connect gate.
  if (isInitializing) {
    return (
      <div className="relative z-10">
        <PageHeader title="Create Position" icon={PlusSquare} />
        <MainCard>
          <div className="flex flex-col gap-6 animate-pulse">
            <Skeleton className="h-6 w-40 rounded" />
            <div className="flex gap-4">
              <Skeleton className="h-20 flex-1 rounded-lg" />
              <Skeleton className="h-20 flex-1 rounded-lg" />
            </div>
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </MainCard>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="relative z-10">
        <PageHeader title="Create Position" icon={PlusSquare} />
        <ConnectWalletGate
          title="Connect your wallet to create a position"
          description="Connect a Solana wallet to compare markets, pick a protocol, and open a new position."
        />
      </div>
    );
  }

  const showRealRanking = Boolean(
    strategy && collateralSelected && comparison && !isLoading,
  );

  return (
    <div className="relative z-10">
      <PageHeader title="Create Position" icon={PlusSquare} />

      <MainCard className="min-h-[calc(100vh-180px)] flex flex-col">
        <div className="relative flex flex-col gap-8 flex-1">
          {/* ─── STEP 1: Compare Protocols ─── */}
          <section className="flex flex-col gap-y-6">
            <Title3 text="Compare Protocols" />

            <div className="flex flex-col sm:flex-row gap-4 mb-2">
              <TokenDropdown
                label="Collateral Asset"
                selectedMint={collateralMint}
                onSelect={handleCollateralSelect}
                tokens={resolvedTokens}
              />
              <TokenDropdown
                label="Debt Asset"
                selectedMint={debtMint}
                onSelect={handleDebtSelect}
                onClear={handleDebtClear}
                tokens={resolvedTokens}
              />
            </div>

            <StrategySelector
              selected={strategy}
              onSelect={handleStrategySelect}
              collateralSelected={collateralSelected}
              debtSelected={debtSelected}
            />
          </section>

          {/* ─── Protocol ranking list (always visible) ─── */}
          <section className="flex flex-col gap-3 flex-1">
            <Title3 text="Select Protocol" />

            {isLoading && collateralSelected && !comparison ? (
              <div className="flex flex-col gap-3 animate-pulse">
                {VISIBLE_PROTOCOLS.map((p) => (
                  <Skeleton key={p} className="h-24 w-full rounded-lg" />
                ))}
              </div>
            ) : showRealRanking ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={strategy ?? "ranking"}
                  variants={fadeVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex flex-col gap-3 overflow-hidden"
                >
                  {sortedMarkets.map((m, i) => (
                    <MarketRankingCard
                      key={m.protocol}
                      market={m}
                      rank={i + 1}
                      isSelected={selectedProtocol === m.protocol}
                      isAvailable={m.available}
                      strategy={strategy!}
                      collateral={collateralToken?.symbol ?? "—"}
                      debt={debtToken?.symbol ?? "—"}
                      onClick={() => {
                        if (!m.available) return;
                        setSelectedProtocol(
                          selectedProtocol === m.protocol ? null : m.protocol,
                        );
                      }}
                    />
                  ))}
                </motion.div>
              </AnimatePresence>
            ) : (
              VISIBLE_PROTOCOLS.map((p) => (
                <PlaceholderMarketCard key={p} protocol={p} />
              ))
            )}
          </section>

          {/* ─── Bottom CTA (always visible, disabled until ready) ─── */}
          <div className="flex justify-end pt-2 mt-auto">
            <ActionButton
              disabled={!canCreate}
              onClick={() => setModalOpen(true)}
              trailingIcon={<ArrowRight size={16} strokeWidth={2.5} />}
            >
              {canCreate && selectedProtocol
                ? `Create Position on ${PROTOCOL_DISPLAY_NAME[selectedProtocol]}`
                : !collateralSelected
                  ? "Pick a collateral asset to start"
                  : "Select a protocol to continue"}
            </ActionButton>
          </div>
        </div>
      </MainCard>

      {/* ─── Modal ─── */}
      <AnimatePresence>
        {modalOpen &&
          selectedMarket?.available &&
          selectedProtocol &&
          collateralToken && (
            <CreatePositionModal
              protocolName={PROTOCOL_DISPLAY_NAME[selectedProtocol]}
              market={selectedMarket}
              collateralToken={collateralToken}
              collateralPrice={collateralPrice}
              debtToken={debtToken}
              debtPrice={debtPrice}
              onClose={() => setModalOpen(false)}
            />
          )}
      </AnimatePresence>
    </div>
  );
}
