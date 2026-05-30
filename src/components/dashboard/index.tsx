"use client";

// TODO FRONTEND: A lot of components here should be moved out and kept in separate files.

import Link from "next/link";
import {
  Home,
  AlertTriangle,
  ArrowUpRight,
  PlusSquare,
  LineChart,
} from "lucide-react";
import type { IconType } from "react-icons";
import { FiActivity, FiChevronDown, FiPercent } from "react-icons/fi";
import { PageHeader } from "@/src/components/page-header";
import { MainCard } from "@/src/components/main-card";
import { ProtocolIcon } from "@/src/components/icons/token-icons";
import { Title3 } from "../ui/title-3";
import { Title4 } from "../ui/title-4";
import { C } from "@/src/lib/theme";
import { useDashboard } from "@/src/lib/api";
import { useConnectedWallet } from "@/src/components/wallet/useConnectedWallet";
import { ConnectWalletGate } from "@/src/components/wallet/connect-wallet";
import { DashboardSkeleton } from "@/src/components/dashboard/dashboard-skeleton";
import {
  Protocol,
  type HealthCardValues,
  type ProtocolDistribution,
} from "@/app/types/main";
import { isProtocolVisible } from "@/src/lib/protocol-visibility";

type Tone = "safe" | "warn" | "danger";

interface ProtocolCardData {
  key: string;
  name: string;
  pct: number;
  status: string;
  tone: Tone;
  spark: number[];
  savings: number;
}

// TODO INTEGRATION: sparkline history isn't returned by /api/dashboard yet.
// Keeping a per-protocol mock until we have a history endpoint that returns it.
const SPARK_BY_PROTOCOL: Record<Protocol, number[]> = {
  [Protocol.Kamino]: [
    18, 20, 19, 22, 24, 23, 26, 28, 27, 30, 32, 31, 34, 36, 38, 40,
  ],
  [Protocol.Drift]: [
    26, 30, 14, 34, 18, 38, 12, 40, 16, 36, 20, 38, 14, 34, 22, 30,
  ],
  [Protocol.Save]: [
    16, 18, 20, 19, 22, 24, 26, 25, 28, 30, 32, 31, 34, 36, 38, 40,
  ],
  [Protocol.JupLend]: [
    40, 38, 37, 35, 32, 30, 28, 26, 23, 22, 20, 18, 15, 13, 11, 9,
  ],
};

const PROTOCOL_SLUG: Record<Protocol, string> = {
  [Protocol.Kamino]: "kamino",
  [Protocol.Drift]: "drift",
  [Protocol.Save]: "save",
  [Protocol.JupLend]: "juplend",
};

const TONE_COLOR: Record<Tone, string> = {
  safe: C.green,
  warn: C.amber,
  danger: C.red,
};

const TONE_TEXT_CLASS: Record<Tone, string> = {
  safe: "text-accent",
  warn: "text-warn",
  danger: "text-danger",
};

function toneFromHealth(pct: number): Tone {
  if (pct >= 50) return "safe";
  if (pct >= 20) return "warn";
  return "danger";
}

function statusFromHealth(pct: number): string {
  if (pct >= 50) return "HEALTHY";
  if (pct >= 20) return "MONITOR";
  return "AT RISK";
}

function fmtMoney(n: number): { whole: string; cents: string } {
  const safe = Number.isFinite(n) ? n : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  const whole = Math.floor(abs).toLocaleString("en-US");
  const cents = (abs - Math.floor(abs)).toFixed(2).slice(1);
  return { whole: `${sign}${whole}`, cents };
}

function fmtSignedUsd(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  const sign = safe >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(safe).toFixed(2)}`;
}

function fmtSignedPct(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  const sign = safe >= 0 ? "+" : "-";
  return `${sign}${Math.abs(safe).toFixed(2)}%`;
}

// // ─── Grid backdrop ──────────────────────────────────────────────────────────

// function GridBackdrop() {
//   return (
//     <div
//       aria-hidden
//       className="
//         pointer-events-none fixed inset-0 z-0 bg-[#020814]
//         bg-[image:radial-gradient(ellipse_90%_60%_at_50%_30%,rgba(29,182,125,0.045)_0%,transparent_55%),linear-gradient(to_right,rgba(29,182,125,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(29,182,125,0.05)_1px,transparent_1px)]
//         bg-[size:100%_100%,96px_96px,96px_96px]
//         bg-[position:0_0,0_0,0_0]
//       "
//     />
//   );
// }

function Divider() {
  return (
    <div className="my-5 h-px w-full bg-[linear-gradient(to_right,transparent,var(--color-border-base)_15%,var(--color-border-base)_85%,transparent)]" />
  );
}

// ─── Top split (net worth + gauge) ──────────────────────────────────────────

function TopSplit({
  healthCard,
  hasPositions,
}: {
  healthCard: HealthCardValues;
  hasPositions: boolean;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 lg:gap-10 items-start">
      <NetWorthBlock healthCard={healthCard} hasPositions={hasPositions} />
      <div className="w-full lg:w-auto flex justify-center">
        <HealthGauge percent={Math.round(healthCard.healthPct)} />
      </div>
    </div>
  );
}

function NetWorthBlock({
  healthCard,
  hasPositions,
}: {
  healthCard: HealthCardValues;
  hasPositions: boolean;
}) {
  const { whole, cents } = fmtMoney(healthCard.netWorth);
  const dailyPnl = healthCard.dailyPnl;
  const netApy =
    healthCard.netWorth > 0 ? (dailyPnl * 365 * 100) / healthCard.netWorth : 0;

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-2">
        {/* Eyebrow */}
        <Title3 text="Total Net Worth" />

        {/* Huge number */}
        <div className="flex items-baseline leading-none font-(family-name:--font-ibm-plex-mono)">
          <span className="relative -top-1 text-[26px] sm:text-[36px] font-semibold tracking-[-0.02em] text-text-base">
            $
          </span>
          <span className="font-extrabold tabular-nums text-[36px] sm:text-[50px] leading-[0.9] tracking-[-0.045em] text-text-bright">
            {whole}
          </span>
          <span className="relative -top-0.5 ml-1 font-bold tabular-nums text-[20px] sm:text-[28px] tracking-[-0.02em] text-text-muted">
            {cents}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="w-full grid grid-cols-2 sm:flex sm:items-start gap-3 sm:gap-4">
        <Stat
          label="Daily P&L"
          value={fmtSignedUsd(dailyPnl)}
          tone={dailyPnl >= 0 ? "up" : "down"}
          icon={FiActivity}
        />
        <Stat
          label="Net APY"
          value={fmtSignedPct(netApy)}
          tone={netApy >= 0 ? "up" : "down"}
          icon={FiPercent}
        />
      </div>

      {/* Save pill + CTAs (or empty-state messaging when there's nothing yet) */}
      {hasPositions ? (
        <div className="flex items-center gap-3 flex-wrap">
          <SavePill distribution={healthCard.distribution} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <span className="font-(family-name:--font-dm-sans) text-[13px] font-semibold text-text-muted">
            You don&apos;t have any positions across protocols yet — open a new
            one or run the simulator to explore.
          </span>
          <DashboardCtas />
        </div>
      )}
    </div>
  );
}

function DashboardCtas() {
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/create-position"
        className="inline-flex items-center justify-center gap-2 h-8 px-4 rounded-md no-underline cursor-pointer bg-[linear-gradient(135deg,#1DB67D_0%,#27C98C_100%)] text-surface-2 border border-accent/30 hover:shadow-[0_6px_16px_rgba(29,182,125,0.20)] transition-all"
      >
        <PlusSquare size={14} strokeWidth={2.4} />
        <span className="font-(family-name:--font-dm-sans) text-[14px] font-bold">
          Create Position
        </span>
      </Link>
      <Link
        href="/simulate"
        className="inline-flex items-center gap-2 h-8 px-4 rounded-md no-underline cursor-pointer bg-white/2 text-text-base border border-border-base hover:bg-white/4 hover:border-[#1E3048] transition-colors"
      >
        <LineChart size={14} strokeWidth={2.2} className="text-text-dim" />
        <span className="font-(family-name:--font-dm-sans) text-[14px] font-bold">
          Simulator
        </span>
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "neutral";
  icon: IconType;
}) {
  const toneClass =
    tone === "up"
      ? "text-accent"
      : tone === "down"
        ? "text-danger"
        : "text-text-base";
  return (
    <div className="w-full sm:w-1/3 sm:min-w-45 flex items-center justify-between gap-3 sm:gap-6 px-3 sm:px-4 py-3 rounded-lg border border-border-base bg-white/2">
      <div className="flex flex-col gap-1 min-w-0">
        <Title4 text={label} />
        <span
          className={`font-(family-name:--font-ibm-plex-mono) text-[16px] sm:text-[20px] font-semibold tabular-nums truncate ${toneClass}`}
        >
          {value}
        </span>
      </div>
      <Icon size={20} className="text-text-muted shrink-0 sm:hidden" />
      <Icon size={25} className="text-text-muted shrink-0 hidden sm:block" />
    </div>
  );
}

function SavePill({ distribution }: { distribution: ProtocolDistribution[] }) {
  const total = distribution.reduce((s, p) => s + (p.monthlySavings ?? 0), 0);

  if (total <= 0) return null;

  const totalDisplay = total.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });

  return (
    <div className="relative group w-fit">
      <button
        type="button"
        className="w-fit inline-flex items-center gap-3 h-8 px-4 rounded-lg border border-border-base bg-white/2 cursor-pointer hover:bg-white/4 group-hover:border-accent/30 transition-colors"
      >
        <span className="font-(family-name:--font-dm-sans) text-[15px] font-medium text-text-base">
          Save
        </span>
        <span className="font-(family-name:--font-ibm-plex-mono) text-[16px] font-semibold tabular-nums text-accent">
          ${totalDisplay}/mo
        </span>
        <span className="hidden sm:inline font-(family-name:--font-ibm-plex-mono) text-[15px] font-semibold tabular-nums text-text-base">
          across {distribution.length} protocols
        </span>
        <FiChevronDown
          size={14}
          className="ml-1 text-text-muted transition-transform duration-200 group-hover:rotate-180 group-hover:text-text-base"
        />
      </button>

      {/* Hover popover */}
      <div
        className="
          absolute top-full left-0 mt-3 w-80 z-50
          opacity-0 translate-y-1 pointer-events-none
          group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto
          transition-all duration-200 ease-out
        "
      >
        {/* Caret */}
        <div className="absolute -top-1.5 left-6 w-3 h-3 rotate-45 border-l border-t border-border-base bg-surface-1" />

        <div className="relative rounded-lg border border-border-base bg-[linear-gradient(180deg,var(--color-surface-1)_0%,var(--color-surface-2)_100%)] shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-(family-name:--font-dm-sans) text-[10.5px] tracking-[0.2em] font-semibold uppercase text-text-muted">
              Savings by Protocol
            </span>
            <span className="font-(family-name:--font-dm-sans) text-[10.5px] tracking-[0.2em] font-semibold uppercase text-text-faint">
              Monthly
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {distribution.map((p) => (
              <div key={p.protocol} className="flex items-center gap-3">
                <ProtocolIcon name={p.protocol} size={24} />
                <span className="flex-1 font-(family-name:--font-dm-sans) text-[13px] font-medium text-text-base">
                  {p.protocol}
                </span>
                <span className="font-(family-name:--font-ibm-plex-mono) text-[13px] font-semibold tabular-nums text-accent">
                  +$
                  {(p.monthlySavings ?? 0).toLocaleString("en-US", {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 pt-3 border-t border-border-base flex items-center">
            <span className="flex-1 font-(family-name:--font-dm-sans) text-[11px] tracking-[0.18em] font-semibold uppercase text-text-muted">
              Total
            </span>
            <span className="font-(family-name:--font-ibm-plex-mono) text-[14px] font-bold tabular-nums text-accent">
              +${totalDisplay}/mo
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Semi-circular health gauge ─────────────────────────────────────────────

function HealthGauge({ percent }: { percent: number }) {
  // TODO FRONTEND: we'll change the color of the gauge depending upon the percentage of the health
  const W = 360;
  const H = 210;
  const cx = W / 2;
  const cy = H - 24;
  const r = 140;
  const stroke = 14;

  const p = Math.max(0, Math.min(100, percent)) / 100;
  const angle = Math.PI * (1 - p);
  const endX = cx + r * Math.cos(angle);
  const endY = cy - r * Math.sin(angle);

  const leftX = cx - r;
  const rightX = cx + r;

  return (
    <div className="flex flex-col items-center w-90">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* Background arc */}
        <path
          d={`M ${leftX} ${cy} A ${r} ${r} 0 0 1 ${rightX} ${cy}`}
          fill="none"
          stroke="rgba(255,255,255,0.055)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />

        {/* Foreground arc */}
        {p > 0 && (
          <path
            d={`M ${leftX} ${cy} A ${r} ${r} 0 0 1 ${endX} ${endY}`}
            fill="none"
            stroke={C.green}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        )}

        {/* Center: HEALTH MONITOR + percent */}
        <g transform={`translate(${cx}, ${cy - 46})`}>
          <text
            textAnchor="middle"
            fontFamily="var(--font-dm-sans), sans-serif"
            fontSize={11}
            fontWeight={700}
            letterSpacing="0.18em"
            fill={C.textMuted}
            y={-20}
          >
            HEALTH MONITOR
          </text>
          <text
            y={30}
            textAnchor="middle"
            fontFamily="var(--font-ibm-plex-mono), monospace"
            fontWeight={700}
            fontSize={40}
            fill={C.green}
            style={{ letterSpacing: "-0.02em" }}
          >
            {percent}%
          </text>
        </g>
      </svg>

      {/* Bottom scale labels */}
      <div className="w-full flex justify-around -mt-1.5">
        <span className="font-(family-name:--font-dm-sans) text-[12px] font-bold uppercase text-text-muted">
          LIQ.
        </span>
        <span className="font-(family-name:--font-dm-sans) text-[12px] font-bold uppercase text-text-muted">
          SAFE
        </span>
        <span className="font-(family-name:--font-dm-sans) text-[12px] font-bold uppercase text-text-muted">
          HEALTHY
        </span>
      </div>
    </div>
  );
}

// ─── Warning banner ─────────────────────────────────────────────────────────

function WarningBanner({ healthCard }: { healthCard: HealthCardValues }) {
  if (healthCard.atRiskPositions <= 0) return null;

  const offenders = healthCard.distribution
    .filter((d) => d.atRiskPositions > 0)
    .map((d) => d.protocol);
  const protocolText =
    offenders.length === 0
      ? ""
      : offenders.length === 1
        ? ` in ${offenders[0]}`
        : ` across ${offenders.join(", ")}`;
  const noun = healthCard.atRiskPositions === 1 ? "Position" : "Positions";

  return (
    <div
      className="
        flex items-center gap-4 px-5 py-2 rounded-md
        bg-[linear-gradient(180deg,rgba(229,83,75,0.06)_0%,rgba(229,83,75,0.02)_100%)]
        shadow-[inset_0_1px_0_rgba(229,83,75,0.05)]
      "
    >
      <div
        className="
          flex items-center justify-center w-10 h-10 rounded-sm shrink-0
          bg-[rgba(229,83,75,0.08)]
        "
      >
        <AlertTriangle size={20} strokeWidth={1.9} className="text-danger" />
      </div>

      <div className="flex flex-col min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-(family-name:--font-dm-sans) text-[14px] font-medium text-danger">
            {healthCard.atRiskPositions} {noun}
            {protocolText} Need{healthCard.atRiskPositions === 1 ? "s" : ""}{" "}
            Attention
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Protocols section ──────────────────────────────────────────────────────

function ProtocolsSection({
  cards,
  totalSuppliedUsd,
  totalBorrowedUsd,
}: {
  cards: ProtocolCardData[];
  totalSuppliedUsd: number;
  totalBorrowedUsd: number;
}) {
  if (totalSuppliedUsd <= 0 && totalBorrowedUsd <= 0) return null;

  const fmt = (n: number) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return (
    <div className="flex flex-col gap-4 mt-4">
      {/* Section header — stacks on mobile so the totals don't crowd the title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <Title3 text="Protocols" />

        <div className="flex flex-wrap items-center gap-x-4 sm:gap-x-6 gap-y-1 font-(family-name:--font-dm-sans) text-[13px] sm:text-[16px] text-text-dim">
          <span>
            Supplied:{"  "}
            <span className="font-(family-name:--font-ibm-plex-mono) font-bold tabular-nums text-text-base">
              ${fmt(totalSuppliedUsd)}
            </span>
          </span>
          <span>
            Borrowed:{"  "}
            <span className="font-(family-name:--font-ibm-plex-mono) font-bold tabular-nums text-text-base">
              ${fmt(totalBorrowedUsd)}
            </span>
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((p) => (
          <ProtocolCard key={p.key} p={p} />
        ))}
      </div>
    </div>
  );
}

function ProtocolCard({ p }: { p: ProtocolCardData }) {
  const color = TONE_COLOR[p.tone];
  const toneClass = TONE_TEXT_CLASS[p.tone];
  return (
    <a
      href={`/protocols/${p.key}`}
      className="
        group flex flex-col p-3 sm:p-4 rounded-lg no-underline
        bg-white/2
        border border-border-base
        transition-transform hover:-translate-y-0.5
      "
    >
      {/* Header row: avatar + name + arrow */}
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
        <ProtocolIcon name={p.name} size={28} className="sm:hidden" />
        <ProtocolIcon name={p.name} size={32} className="hidden sm:block" />
        <span className="font-(family-name:--font-dm-sans) text-[12px] sm:text-[13px] font-semibold text-text-bright truncate">
          {p.name}
        </span>
        <span className="flex-1" />
        <ArrowUpRight
          size={15}
          strokeWidth={2}
          className="text-text-muted shrink-0 transition-colors duration-200 group-hover:text-white"
        />
      </div>

      {/* Big percent + status — wraps onto two lines on narrow widths so
          neither the % glyph nor the status badge get pushed off-row. */}
      <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap mt-3 sm:mt-4">
        <span
          className={`font-(family-name:--font-ibm-plex-mono) font-bold tabular-nums leading-none text-[24px] sm:text-[30px] tracking-[-0.02em] ${toneClass}`}
        >
          {p.pct}
        </span>
        <span
          className={`font-(family-name:--font-ibm-plex-mono) font-semibold tabular-nums leading-none text-[12px] sm:text-[14px] opacity-75 ${toneClass}`}
        >
          %
        </span>
        <span className="flex-1 basis-2" />
        <span
          className={`font-(family-name:--font-dm-sans) text-[9px] sm:text-[10px] tracking-[0.14em] sm:tracking-widest font-semibold uppercase opacity-85 whitespace-nowrap ${toneClass}`}
        >
          {p.status}
        </span>
      </div>

      {/* Sparkline */}
      <div className="mt-4">
        <Sparkline values={p.spark} color={color} />
      </div>
    </a>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 200;
  const H = 44;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return [x, y] as const;
  });

  const d = points
    .map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
    .join(" ");

  const areaD = `${d} L ${points[points.length - 1][0]} ${H} L ${points[0][0]} ${H} Z`;
  const gradId = `spark-grad-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.40" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      {/* <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      /> */}
    </svg>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const {
    address: walletAddress,
    isConnected,
    isInitializing,
  } = useConnectedWallet();
  const { data, error, isLoading } = useDashboard(walletAddress);

  let body: React.ReactNode;
  if (isInitializing) {
    body = <DashboardSkeleton />;
  } else if (!isConnected) {
    body = (
      <ConnectWalletGate
        title="Connect your wallet"
        description="Connect a Solana wallet to load your portfolio and protocol positions."
      />
    );
  } else if (isLoading && !data) {
    body = <DashboardSkeleton />;
  } else if (error) {
    // TODO FRONTEND: this error state could be improved a lot with some design work
    body = (
      <div className="py-16 text-center font-(family-name:--font-dm-sans) text-[14px] text-danger">
        Failed to load dashboard: {error.message}
      </div>
    );
  } else if (data) {
    const { healthCard, positions } = data;

    const totalSuppliedUsd = positions.reduce(
      (s, p) => s + p.totalCollateralUsd,
      0,
    );
    const totalBorrowedUsd = positions.reduce((s, p) => s + p.totalDebtUsd, 0);

    // Per-protocol average healthPct (debt-weighted; fallback to simple mean).
    const healthByProtocol = new Map<Protocol, number>();
    for (const proto of Object.values(Protocol)) {
      const protoPositions = positions.filter((p) => p.protocol === proto);
      if (protoPositions.length === 0) continue;
      const totalDebt = protoPositions.reduce((s, p) => s + p.totalDebtUsd, 0);
      const weighted =
        totalDebt > 0
          ? protoPositions.reduce(
              (s, p) => s + p.healthPct * p.totalDebtUsd,
              0,
            ) / totalDebt
          : protoPositions.reduce((s, p) => s + p.healthPct, 0) /
            protoPositions.length;
      healthByProtocol.set(proto, weighted);
    }

    // Per-protocol total collateral. JupLend's data layer keeps zeroed
    // positions around as reuse targets for the refinance picker; drop a
    // protocol's card here when none of its positions have any collateral.
    const collateralByProtocol = new Map<Protocol, number>();
    for (const p of positions) {
      collateralByProtocol.set(
        p.protocol,
        (collateralByProtocol.get(p.protocol) ?? 0) + p.totalCollateralUsd,
      );
    }

    // Build cards for every distribution entry; if a protocol has no health
    // value (collateral-only) fall back to 100.
    const cards: ProtocolCardData[] = healthCard.distribution
      .filter((d) => isProtocolVisible(d.protocol))
      .filter((d) => (collateralByProtocol.get(d.protocol) ?? 0) > 0)
      .map((d) => {
        const pct = Math.round(healthByProtocol.get(d.protocol) ?? 100);
        return {
          key: PROTOCOL_SLUG[d.protocol] ?? d.protocol.toLowerCase(),
          name: d.protocol,
          pct,
          status: statusFromHealth(pct),
          tone: toneFromHealth(pct),
          spark: SPARK_BY_PROTOCOL[d.protocol] ?? [],
          savings: Math.round(d.monthlySavings ?? 0),
        };
      });

    body = (
      <>
        <TopSplit hasPositions={cards.length > 0} healthCard={healthCard} />
        <Divider />
        <WarningBanner healthCard={healthCard} />
        <ProtocolsSection
          cards={cards}
          totalSuppliedUsd={totalSuppliedUsd}
          totalBorrowedUsd={totalBorrowedUsd}
        />
      </>
    );
  } else {
    body = null;
  }

  return (
    <div className="relative z-10">
      <PageHeader title="Dashboard" icon={Home} />
      <MainCard>{body}</MainCard>
    </div>
  );
}
