import { useState } from "react";
import {
  CollateralAsset,
  DebtAsset,
  JuplendPairPosition,
  ProtocolDetail,
} from "../page";
import { TokenIcon, TokenPairIcon } from "@/src/components/icons/token-icons";
import { C } from "@/src/lib/theme";
import { Title3 } from "@/src/components/ui/title-3";
import { Title4 } from "@/src/components/ui/title-4";
import { AlertTriangle, ChevronRight, Shield } from "lucide-react";
import { motion } from "framer-motion";
import {
  PositionActionModal,
  type ActionTarget,
} from "@/src/components/protocol/position-action-modal";

function ChevronArrow({ hovered }: { hovered: boolean }) {
  return (
    <div
      className="flex items-center justify-center rounded-full"
      style={{
        width: 32,
        height: 32,
        border: `1px solid ${hovered ? C.borderLit : C.border}`,
        background: hovered ? C.white04 : "transparent",
        transition: "all 180ms ease",
      }}
    >
      <ChevronRight
        size={20}
        strokeWidth={2.2}
        style={{
          color: hovered ? C.textSec : C.textMuted,
          transition: "color 180ms ease",
        }}
      />
    </div>
  );
}

function statusColor(status: string): {
  color: string;
  bg: string;
  border: string;
} {
  switch (status) {
    case "Healthy":
      return { color: C.accent, bg: C.accentTint, border: C.accentBord };
    case "Moderate":
      return {
        color: C.yellow,
        bg: "rgba(229,169,62,0.08)",
        border: "rgba(229,169,62,0.22)",
      };
    case "At Risk":
      return {
        color: C.red,
        bg: "rgba(229,83,75,0.08)",
        border: "rgba(229,83,75,0.22)",
      };
    default:
      return { color: C.textMuted, bg: C.white04, border: C.border };
  }
}

function JuplendPositionsSection({
  pairs,
  onPairClick,
}: {
  pairs: JuplendPairPosition[];
  onPairClick: (pair: JuplendPairPosition) => void;
}) {
  if (pairs.length === 0) {
    return (
      <section className="space-y-3">
        <Title3 text="Active Positions" />
        <div className="rounded-lg border bg-white/2 border-border-base py-10 text-center text-[13px] text-text-muted">
          No JupLend positions for this wallet.
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <Title3 text="Active Positions" />
      <div className="flex flex-col gap-2.5">
        {pairs.map((pair) => (
          <JuplendPairCard
            key={pair.id}
            pair={pair}
            onClick={() => onPairClick(pair)}
          />
        ))}
      </div>
    </section>
  );
}

function JuplendPairCard({
  pair,
  onClick,
}: {
  pair: JuplendPairPosition;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const sc = statusColor(pair.status);
  const isCollateralOnly = pair.debtAmount === 0;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className="flex items-center gap-3 sm:gap-4 rounded-lg border px-4 sm:px-6 py-3 sm:py-0 cursor-pointer bg-white/2 border-border-base hover:bg-white/4 focus:outline-none focus:ring-1 focus:ring-accent/40 sm:h-[84px]"
        style={{
          transition: "all 180ms ease",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {isCollateralOnly ? (
          <TokenIcon
            symbol={pair.collateralSymbol}
            logoUrl={pair.collateralLogoUrl}
            size={32}
          />
        ) : (
          <TokenPairIcon
            collateralSymbol={pair.collateralSymbol}
            debtSymbol={pair.debtSymbol}
            collateralLogoUrl={pair.collateralLogoUrl}
            debtLogoUrl={pair.debtLogoUrl}
            size={32}
          />
        )}

        {/* Left: collateral (+ debt if present) amounts */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-(family-name:--font-ibm-plex-mono) text-[15px] font-bold tracking-tight text-text-base">
            {pair.collateralAmountStr}
            {!isCollateralOnly && (
              <>
                {" "}
                <span className="text-text-muted">/</span>{" "}
                {pair.debtAmountStr}
              </>
            )}
          </span>
          <div className="flex items-center gap-1">
            <span className="font-(family-name:--font-ibm-plex-mono) text-[11.5px] font-semibold text-text-muted">
              {pair.collateralValueUsd}
            </span>
            {!isCollateralOnly && (
              <>
                <span className="font-(family-name:--font-dm-sans) text-[12px] text-text-muted">
                  /
                </span>
                <span className="font-(family-name:--font-ibm-plex-mono) text-[11.5px] font-semibold text-text-muted">
                  {pair.debtValueUsd}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right: metrics + status. On mobile only Health + status remain
            visible; LTV / Net APY hide to keep the row from squashing.
            Collateral-only positions have no LTV or net APY to show. */}
        <div className="ml-auto flex items-center gap-3 sm:gap-5">
          {!isCollateralOnly && (
            <>
              <div className="hidden md:flex flex-col items-end">
                <span className="font-(family-name:--font-dm-sans) text-[12px] font-semibold uppercase tracking-widest text-text-muted">
                  LTV
                </span>
                <span className="font-(family-name:--font-ibm-plex-mono) text-[14px] font-bold text-text-base">
                  {pair.ltv}%
                </span>
              </div>
              <div className="hidden md:flex flex-col items-end">
                <span className="font-(family-name:--font-dm-sans) text-[12px] font-semibold uppercase tracking-widest text-text-muted">
                  Net APY
                </span>
                <span
                  className="font-(family-name:--font-ibm-plex-mono) text-[14px] font-bold"
                  style={{ color: pair.netApy >= 0 ? C.accent : C.red }}
                >
                  {pair.netApy >= 0 ? "+" : "-"}
                  {Math.abs(pair.netApy).toFixed(2)}%
                </span>
              </div>
            </>
          )}
          {isCollateralOnly && pair.supplyApy != null && (
            <div className="hidden md:flex flex-col items-end">
              <span className="font-(family-name:--font-dm-sans) text-[12px] font-semibold uppercase tracking-widest text-text-muted">
                Supply APY
              </span>
              <span className="font-(family-name:--font-ibm-plex-mono) text-[14px] font-bold text-accent">
                {pair.supplyApy.toFixed(2)}%
              </span>
            </div>
          )}
          <div className="flex flex-col items-end">
            <span className="font-(family-name:--font-dm-sans) text-[11px] sm:text-[12px] font-semibold uppercase tracking-widest text-text-muted">
              Health
            </span>
            <span
              className="font-(family-name:--font-ibm-plex-mono) text-[13px] sm:text-[14px] font-bold"
              style={{ color: sc.color }}
            >
              {pair.health}%
            </span>
          </div>
          <span
            className="hidden sm:inline font-(family-name:--font-dm-sans) text-[10px] font-semibold px-2.5 py-1 rounded-sm"
            style={{
              color: sc.color,
              background: sc.bg,
            }}
          >
            {pair.status}
          </span>
          <ChevronArrow hovered={hovered} />
        </div>
      </div>
    </motion.div>
  );
}

function CollateralTable({
  assets,
  onAssetClick,
}: {
  assets: CollateralAsset[];
  onAssetClick: (asset: CollateralAsset) => void;
}) {
  return (
    <section className="space-y-3">
      <Title3 text="Collateral Assets" />
      <div className="rounded-lg bg-white/2 border overflow-x-auto custom-scrollbar border-border-base">
        <div className="min-w-[640px]">
          <div
            className="grid px-5 py-2.5"
            style={{
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 40px",
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            {["Asset", "Balance", "Value", "Supply APY", "Rewards"].map((h) => (
              <Title4 key={h} text={h} />
            ))}
            <span />
          </div>
          {assets.map((a) => (
            <CollateralRow
              key={a.symbol}
              asset={a}
              onClick={() => onAssetClick(a)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CollateralRow({
  asset,
  onClick,
}: {
  asset: CollateralAsset;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="grid px-5 py-3.5 cursor-pointer focus:outline-none focus:bg-white/4"
      style={{
        gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 40px",
        background: hovered ? C.white04 : "transparent",
        borderBottom: `1px solid ${C.border}`,
        transition: "background 150ms ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-3">
        <TokenIcon symbol={asset.symbol} logoUrl={asset.logoUrl} size={26} />
        <div className="flex flex-col">
          <span className="text-[13px] font-bold text-text-base">
            {asset.symbol}
          </span>
          <span className="text-[11.5px] font-semibold text-text-muted">
            {asset.name}
          </span>
        </div>
      </div>
      <span className="text-[13px] font-(family-name:--font-ibm-plex-mono) font-bold self-center text-text-dim">
        {asset.balanceStr}
      </span>
      <span className="text-[13px] font-(family-name:--font-ibm-plex-mono) font-bold self-center text-text-base">
        {asset.valueUsd}
      </span>
      <span className="text-[13px] font-(family-name:--font-ibm-plex-mono) font-bold self-center text-accent">
        {asset.supplyAPY}
      </span>
      <span className="text-[13px] font-(family-name:--font-ibm-plex-mono) font-bold self-center text-text-muted">
        {asset.rewards}
      </span>
      <div className="self-center justify-self-end">
        <ChevronArrow hovered={hovered} />
      </div>
    </div>
  );
}

function DebtTable({
  assets,
  onAssetClick,
}: {
  assets: DebtAsset[];
  onAssetClick: (asset: DebtAsset) => void;
}) {
  return (
    <section className="space-y-3">
      <Title3 text="Debt Assets" />

      <div className="rounded-lg bg-white/2 border overflow-x-auto custom-scrollbar border-border-base">
        <div className="min-w-[640px]">
          <div
            className="grid px-5 py-2.5"
            style={{
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 40px",
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            {["Asset", "Borrowed", "Value", "Borrow APR", "Savings"].map((h) => (
              <Title4 key={h} text={h} />
            ))}
            <span />
          </div>
          {assets.map((a) => (
            <DebtRow key={a.symbol} asset={a} onClick={() => onAssetClick(a)} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DebtRow({
  asset,
  onClick,
}: {
  asset: DebtAsset;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [savingsHovered, setSavingsHovered] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="grid px-5 py-3.5 cursor-pointer focus:outline-none focus:bg-white/4"
      style={{
        gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 40px",
        background: hovered ? C.white04 : "transparent",
        borderBottom: `1px solid ${C.border}`,
        transition: "background 150ms ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-3">
        <TokenIcon symbol={asset.symbol} logoUrl={asset.logoUrl} size={26} />
        <div className="flex flex-col">
          <span className="text-[13px] font-bold text-text-base">
            {asset.symbol}
          </span>
          <span className="text-[11.5px] font-semibold text-text-muted">
            {asset.name}
          </span>
        </div>
      </div>
      <span className="text-[13px] font-(family-name:--font-ibm-plex-mono) font-bold self-center text-text-dim">
        {asset.borrowedStr}
      </span>
      <span className="text-[13px] font-(family-name:--font-ibm-plex-mono) font-bold self-center text-text-base">
        {asset.valueUsd}
      </span>
      <span className="text-[13px] font-(family-name:--font-ibm-plex-mono) font-bold self-center text-danger">
        {asset.borrowAPRStr}
      </span>
      <div className="self-center">
        {asset.savings ? (
          <span
            className="text-[13px] font-bold cursor-pointer"
            style={{
              color: C.accent,
              textDecoration: savingsHovered ? "underline" : "none",
              textUnderlineOffset: 2,
              opacity: savingsHovered ? 1 : 0.85,
              transition: "all 150ms ease",
            }}
            onMouseEnter={() => setSavingsHovered(true)}
            onMouseLeave={() => setSavingsHovered(false)}
          >
            Save {asset.savings.amount} &rarr; {asset.savings.protocol}
          </span>
        ) : (
          <span className="text-[11px] text-text-muted">&mdash;</span>
        )}
      </div>
      <div className="self-center justify-self-end">
        <ChevronArrow hovered={hovered} />
      </div>
    </div>
  );
}

function SafetySection({ protocol }: { protocol: ProtocolDetail }) {
  const maxLTV = protocol.maxLTV;
  const hasRisk = maxLTV != null && maxLTV > 0;

  // No collateral on this protocol, no LTV bar to show.
  if (!hasRisk) {
    return (
      <section className="space-y-3">
        <Title3 text="Safety &amp; Risk" />
        <div className="rounded-lg border px-6 py-5 bg-white/2 border-border-base">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Shield size={14} strokeWidth={1.8} className="text-text-muted" />
              <span className="text-[14px] font-bold text-text-base">
                Loan-to-Value
              </span>
            </div>
            <span className="text-[12px] text-text-muted font-semibold">—</span>
          </div>
        </div>
      </section>
    );
  }

  const ltvPct = (protocol.currentLTV / maxLTV) * 100;
  const ltvColor =
    protocol.currentLTV < maxLTV * 0.5
      ? C.accent
      : protocol.currentLTV < maxLTV * 0.8
        ? C.yellow
        : C.red;
  const trackGradient = `linear-gradient(90deg, ${C.accent} 0%, ${C.yellow} 60%, ${C.red} 100%)`;
  return (
    <section className="space-y-3">
      <Title3 text="Safety &amp; Risk" />
      <div className="rounded-lg border px-6 py-5 bg-white/2 border-border-base">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1">
            <Shield size={14} strokeWidth={1.8} style={{ color: ltvColor }} />
            <span className="text-[14px] font-bold text-text-base">
              Loan-to-Value
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="text-[14px] font-(family-name:--font-ibm-plex-mono) font-bold"
              style={{ color: ltvColor }}
            >
              {protocol.currentLTV}%
            </span>
            <span className="text-[12px] text-text-muted font-semibold">
              / {maxLTV.toFixed(1)}% max
            </span>
          </div>
        </div>
        <div className="relative mb-5">
          <div className="relative h-1.5 rounded-full overflow-hidden bg-border-base">
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${ltvPct}%`,
                background: trackGradient,
                transition: "width 200ms ease",
              }}
            />
          </div>
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
            style={{ left: "85%", background: C.yellow + "80" }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4.5 h-4.5 rounded-full border-3 border-border-base"
            style={{
              left: `calc(${ltvPct}% - 6px)`,
              background: C.card,
              transition: "left 200ms ease",
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} strokeWidth={1.8} className="text-warn" />
          <span className="text-[14px] font-semibold text-text-dim">
            Liquidation price:{" "}
            <span className="font-(family-name:--font-ibm-plex-mono) font-semibold text-text-base">
              {protocol.liquidationPrice}
            </span>
            <span className="text-text-muted font-semibold">
              {" "}
              ({protocol.liquidationDistance} away)
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

function NetAPYBreakdown({ protocol }: { protocol: ProtocolDetail }) {
  return (
    <section className="space-y-3">
      <Title3 text="Net APY Breakdown" />
      <div className="rounded-lg border px-5 py-4 bg-white/2 border-border-base">
        <div className="flex items-center justify-between py-2.5">
          <Title4 text="Supply Earnings" />
          <span className="text-[13px] font-(family-name:--font-ibm-plex-mono) font-bold text-accent">
            {protocol.supplyEarnings}/day
          </span>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <Title4 text="Borrow Costs" />
          <span className="text-[13px] font-(family-name:--font-ibm-plex-mono) font-bold text-danger">
            {protocol.borrowCosts}/day
          </span>
        </div>
        <div className="h-px my-2 bg-border-base" />
        <div className="flex items-center justify-between py-2.5">
          <span className="text-[15px] font-bold text-text-base">Net</span>
          <span
            className="text-[15px] font-(family-name:--font-ibm-plex-mono) font-bold"
            style={{
              color: protocol.netDaily.startsWith("+") ? C.accent : C.red,
            }}
          >
            {protocol.netDaily}/day
          </span>
        </div>
      </div>
    </section>
  );
}

export const Overview = ({
  protocol,
  refetch,
}: {
  protocol: ProtocolDetail;
  refetch?: (opts?: { noCache?: boolean }) => void;
}) => {
  const [target, setTarget] = useState<ActionTarget | null>(null);

  return (
    <div className="flex flex-col gap-8">
      {protocol.slug === "juplend" ? (
        <JuplendPositionsSection
          pairs={protocol.pairs}
          onPairClick={(pair) => setTarget({ kind: "pair", pair })}
        />
      ) : (
        <>
          <CollateralTable
            assets={protocol.collateralAssets}
            onAssetClick={(asset) => setTarget({ kind: "collateral", asset })}
          />
          <DebtTable
            assets={protocol.debtAssets}
            onAssetClick={(asset) => setTarget({ kind: "debt", asset })}
          />
        </>
      )}
      <SafetySection protocol={protocol} />
      <NetAPYBreakdown protocol={protocol} />

      {target && (
        <PositionActionModal
          protocol={protocol}
          target={target}
          onClose={() => setTarget(null)}
          onConfirmed={() => refetch?.({ noCache: true })}
        />
      )}
    </div>
  );
};
