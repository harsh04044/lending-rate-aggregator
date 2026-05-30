"use client";

import { useState } from "react";
import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  Wallet,
  CreditCard,
  Shield,
  PlusSquare,
  LineChart,
  Inbox,
} from "lucide-react";
import { ProtocolIcon } from "@/src/components/icons/token-icons";
import { Title4 } from "@/src/components/ui/title-4";
import { MainCard } from "@/src/components/main-card";
import { WalletPill } from "@/src/components/wallet-pill";
import { HistoryEntry, HistoryTab } from "./_components/history";
import { C } from "@/src/lib/theme";
// import { ClearTab } from "./_components/clear";
// import { WithdrawTab } from "./_components/withdraw";
import { Overview } from "./_components/overview";
// import { SimulatorTab } from "./_components/simulator";
import { OptimizeTab } from "./_components/optimize";
import { ProtocolPageSkeleton } from "./_components/protocol-page-skeleton";
import { useProtocol } from "@/src/lib/api";
import type { Protocol } from "@/app/types/main";
import { useConnectedWallet } from "@/src/components/wallet/useConnectedWallet";
import { ConnectWalletGate } from "@/src/components/wallet/connect-wallet";

export interface CollateralAsset {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: number;
  balanceStr: string;
  valueUsd: string;
  valueNum: number;
  supplyAPY: string;
  rewards: string;
  price: number;
  logoUrl?: string;
  meta?: Record<string, unknown>;
}

export interface DebtAsset {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  borrowed: number;
  borrowedStr: string;
  valueUsd: string;
  valueNum: number;
  borrowAPR: number;
  borrowAPRStr: string;
  savings: { amount: string; protocol: string } | null;
  logoUrl?: string;
  meta?: Record<string, unknown>;
}

export interface Position {
  id: string;
  type: "Lend" | "Borrow";
  asset: string;
  amount: string;
  valueUsd: string;
  apy: string;
  health: number;
  status: "Healthy" | "At Risk" | "Moderate";
  logoUrl?: string;
}

export interface JuplendPairPosition {
  id: string;
  collateralMint: string;
  collateralSymbol: string;
  collateralDecimals: number;
  collateralAmount: number;
  collateralAmountStr: string;
  collateralValueUsd: string;
  collateralLogoUrl?: string;
  debtMint: string;
  debtSymbol: string;
  debtDecimals: number;
  debtAmount: number;
  debtAmountStr: string;
  debtValueUsd: string;
  debtLogoUrl?: string;
  ltv: number;
  // Per-obligation risk params (USD-weighted across this pair's collaterals).
  // null when the obligation has no collateral.
  maxLTV: number | null;
  liqThreshold: number | null;
  health: number;
  status: "Healthy" | "At Risk" | "Moderate";
  netApy: number;
  supplyApy: number | null;
  borrowApy: number | null;
  // Per-protocol tx-building meta. Shape varies by protocol, modal casts
  // based on protocol.slug.
  meta?: Record<string, unknown>;
}

type Metrics = {
  borrowAPR: string;
  supplyAPY: string;
  health: string;
  maxLTV: string;
};

export interface ProtocolDetail {
  /** Canonical protocol enum value — used by tx code paths and the cache
   *  invalidation API. The `slug` is the URL identifier and `name` is the
   *  display label; this is the one to compare against `Protocol.X`. */
  protocol: Protocol;
  name: string;
  slug: string;
  color: string;
  safetyScore: number;
  totalCollateral: string;
  totalCollateralNum: number;
  totalDebt: string;
  totalDebtNum: number;
  netAPY: string;
  currentLTV: number;
  // null when the API doesn't provide risk params for this wallet's
  // collateral set (e.g. no positions on this protocol).
  maxLTV: number | null;
  liqThreshold: number | null;
  liquidationPrice: string;
  liquidationDistance: string;
  collateralAssets: CollateralAsset[];
  debtAssets: DebtAsset[];
  positions: Position[];
  pairs: JuplendPairPosition[];
  history: HistoryEntry[];
  supplyEarnings: string;
  borrowCosts: string;
  netDaily: string;
  metrics: Metrics;
}

// TODO FRONTEND: Clear and Withdraw are commented out — those flows are
// being merged into per-asset/per-position action modals (triggered from the
// Overview rows). Keeping the underlying components & ProtocolDetail fields
// in place so we can plug them back in later without re-doing the wiring.
const TABS = [
  "Overview",
  "History",
  "Optimize",
  // "Clear",
  // "Withdraw",
  // "Simulator",
] as const;
type Tab = (typeof TABS)[number];

function safetyColor(score: number): string {
  if (score >= 75) return C.accent;
  if (score >= 50) return C.yellow;
  return C.red;
}

function ProtocolHeader({ protocol }: { protocol: ProtocolDetail }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-7">
      {/* Wallet pill: rendered first on mobile so it sits above the title;
          on desktop it floats to the right of the title via flex-row. */}
      <div className="flex items-center gap-3 shrink-0 self-end sm:order-2">
        <WalletPill />
      </div>

      <div className="flex items-center gap-2.5 min-w-0 sm:order-1">
        <ProtocolIcon name={protocol.name} size={35} />
        <h1 className="font-(family-name:--font-dm-sans) text-[24px] sm:text-[36px] font-bold tracking-[-0.02em] leading-[1.1] mt-0.5 text-text-bright truncate">
          {protocol.name}
        </h1>
      </div>
    </div>
  );
}

function TopStatCard({
  icon: Icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex-1 rounded-lg border px-5 py-4 bg-white/2 border-border-base">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Icon size={18} strokeWidth={1.8} className="text-text-muted" />
        <Title4 text={label} />
      </div>
      <span
        className="font-(family-name:--font-ibm-plex-mono) text-[22px] font-bold tracking-tight"
        style={{ color: valueColor ?? C.text }}
      >
        {value}
      </span>
    </div>
  );
}

function TabNav({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <div className="inline-flex rounded-md overflow-x-auto custom-scrollbar max-w-full border bg-white/2 border-border-base">
      {TABS.map((t) => {
        const isActive = t === active;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className="px-4 sm:px-5 py-2 text-[13px] sm:text-[14px] font-bold cursor-pointer select-none whitespace-nowrap"
            style={{
              color: isActive ? C.text : C.textMuted,
              background: isActive ? C.active : "transparent",
              transition: "all 160ms ease",
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

export default function ProtocolPage() {
  const params = useParams();
  const slug = (params.slug as string) ?? "kamino";
  const {
    address: walletAddress,
    isConnected,
    isInitializing,
  } = useConnectedWallet();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const {
    data: protocol,
    error,
    isLoading,
    isUnknownSlug,
    refetch,
  } = useProtocol(slug, walletAddress);

  // While the wallet adapter is still resolving (auto-connect, hydration),
  // show the skeleton instead of the connect gate so it doesn't flash.
  if (isInitializing) {
    return <ProtocolPageSkeleton />;
  }

  if (!isConnected) {
    return (
      <ConnectWalletGate
        title="Connect your wallet"
        description="Connect a Solana wallet to view your positions and risk parameters in this protocol."
      />
    );
  }

  if (isUnknownSlug) {
    notFound();
  }

  if (isLoading && !protocol) {
    return <ProtocolPageSkeleton />;
  }

  if (error) {
    return (
      <div className="relative z-10">
        <MainCard>
          <div className="py-16 text-center font-(family-name:--font-dm-sans) text-[14px] text-danger">
            Failed to load protocol: {error.message}
          </div>
        </MainCard>
      </div>
    );
  }

  if (!protocol) {
    return null;
  }

  const netColor = protocol.netAPY.startsWith("+") ? C.accent : C.red;
  const safetyValueColor = safetyColor(protocol.safetyScore);

  // JupLend's data layer keeps zeroed pair slots around as reuse targets
  // for the refinance picker — those don't count as positions for the UI.
  const hasPositions =
    protocol.slug === "juplend"
      ? protocol.pairs.some((p) => p.collateralAmount > 0)
      : protocol.collateralAssets.length > 0 || protocol.debtAssets.length > 0;

  return (
    <div className="relative z-10">
      <ProtocolHeader protocol={protocol} />
      <MainCard>
        {hasPositions ? (
          <>
            <div className="grid grid-cols-2 sm:flex sm:gap-4 gap-3 mb-8">
              <TopStatCard
                icon={Wallet}
                label="Total Collateral"
                value={protocol.totalCollateral}
              />
              <TopStatCard
                icon={CreditCard}
                label="Total Debt"
                value={protocol.totalDebt}
              />
              <TopStatCard
                icon={TrendingUp}
                label="Net APY"
                value={protocol.netAPY}
                valueColor={netColor}
              />
              <TopStatCard
                icon={Shield}
                label="Safety"
                value={`${protocol.safetyScore}%`}
                valueColor={safetyValueColor}
              />
            </div>
            <div className="mb-8">
              <TabNav active={activeTab} onChange={setActiveTab} />
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              >
                {activeTab === "Overview" && (
                  <Overview protocol={protocol} refetch={refetch} />
                )}
                {activeTab === "Optimize" && (
                  <OptimizeTab protocol={protocol} refetch={refetch} />
                )}
                {/* {activeTab === "Simulator" && (
                  <SimulatorTab protocol={protocol} />
                )} */}
                {activeTab === "History" && <HistoryTab protocol={protocol} />}
              </motion.div>
            </AnimatePresence>
          </>
        ) : (
          <NoPositionsEmptyState protocolName={protocol.name} />
        )}
      </MainCard>
    </div>
  );
}

function NoPositionsEmptyState({ protocolName }: { protocolName: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-5 bg-accent/8 border border-accent/20">
        <Inbox size={24} strokeWidth={1.8} className="text-accent" />
      </div>
      <h3 className="font-(family-name:--font-dm-sans) text-[18px] font-bold text-text-base mb-2">
        No positions on {protocolName} yet
      </h3>
      <p className="font-(family-name:--font-dm-sans) text-[13.5px] font-semibold text-text-muted max-w-md mb-6">
        You don&apos;t have any active positions here. Open a new one or run the
        simulator to explore strategies before committing.
      </p>
      <div className="flex items-center gap-2">
        <Link
          href="/create-position"
          className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md no-underline cursor-pointer bg-[linear-gradient(135deg,#1DB67D_0%,#27C98C_100%)] text-surface-2 border border-accent/30 hover:shadow-[0_6px_16px_rgba(29,182,125,0.20)] transition-all"
        >
          <PlusSquare size={14} strokeWidth={2.4} />
          <span className="font-(family-name:--font-dm-sans) text-[14px] font-bold">
            Create Position
          </span>
        </Link>
        <Link
          href="/simulate"
          className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md no-underline cursor-pointer bg-white/2 text-text-base border border-border-base hover:bg-white/4 hover:border-[#1E3048] transition-colors"
        >
          <LineChart size={14} strokeWidth={2.2} className="text-text-dim" />
          <span className="font-(family-name:--font-dm-sans) text-[14px] font-bold">
            Simulator
          </span>
        </Link>
      </div>
    </div>
  );
}
