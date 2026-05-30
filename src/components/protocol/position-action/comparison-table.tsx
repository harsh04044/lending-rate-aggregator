import { Title4 } from "@/src/components/ui/title-4";
import { C } from "@/src/lib/theme";
import type { simulateAction } from "@/src/lib/simulate";
import { fmtPct, fmtUsd } from "./format";

// Shows current vs simulated values for collateral, debt, LTV, max LTV,
// health, and liquidation headroom. Pure render — no business logic.
export function ComparisonTable({
  sim,
  hasInput,
  maxLtv,
}: {
  sim: ReturnType<typeof simulateAction>;
  hasInput: boolean;
  maxLtv: number | null;
}) {
  const maxLtvStr = maxLtv != null ? fmtPct(maxLtv) : "—";
  return (
    <div className="rounded-lg bg-surface-2 px-5 py-4">
      <div
        className="grid pb-2.5 mb-1"
        style={{
          gridTemplateColumns: "1fr 1fr 1fr",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <Title4 text="Metric" />
        <span className="font-(family-name:--font-dm-sans) text-[12px] tracking-widest font-bold uppercase text-text-muted text-right">
          Current
        </span>
        <span className="font-(family-name:--font-dm-sans) text-[12px] tracking-widest font-bold uppercase text-text-muted text-right">
          Simulated
        </span>
      </div>
      <Row
        label="Collateral"
        current={fmtUsd(sim.currentCollateralUsd)}
        simulated={fmtUsd(sim.newCollateralUsd)}
        active={hasInput}
      />
      <Row
        label="Debt"
        current={fmtUsd(sim.currentDebtUsd)}
        simulated={fmtUsd(sim.newDebtUsd)}
        active={hasInput}
      />
      <Row
        label="LTV"
        current={fmtPct(sim.currentLTV)}
        simulated={fmtPct(sim.newLTV)}
        active={hasInput}
        tone={sim.ltvDelta > 0 ? "down" : sim.ltvDelta < 0 ? "up" : "neutral"}
      />
      <Row
        label="Max LTV"
        current={maxLtvStr}
        simulated={maxLtvStr}
        active={false}
      />
      <Row
        label="Health"
        current={fmtPct(sim.currentHealth)}
        simulated={fmtPct(sim.newHealth)}
        active={hasInput}
        tone={
          sim.healthDelta > 0 ? "up" : sim.healthDelta < 0 ? "down" : "neutral"
        }
      />
      <Row
        label="Liq. headroom"
        current={
          sim.liqDistanceCurrent != null
            ? `${sim.liqDistanceCurrent.toFixed(1)}%`
            : "—"
        }
        simulated={
          sim.liqDistanceNew != null ? `${sim.liqDistanceNew.toFixed(1)}%` : "—"
        }
        active={hasInput}
        last
      />
    </div>
  );
}

function Row({
  label,
  current,
  simulated,
  active,
  tone,
  last,
}: {
  label: string;
  current: string;
  simulated: string;
  active: boolean;
  tone?: "up" | "down" | "neutral";
  last?: boolean;
}) {
  const simColor =
    !active || tone === "neutral" || tone === undefined
      ? C.text
      : tone === "up"
        ? C.accent
        : C.red;
  return (
    <div
      className="grid py-2.5"
      style={{
        gridTemplateColumns: "1fr 1fr 1fr",
        borderBottom: last ? undefined : `1px solid ${C.border}`,
      }}
    >
      <span className="font-(family-name:--font-dm-sans) text-[12px] font-semibold text-text-dim self-center">
        {label}
      </span>
      <span className="font-(family-name:--font-ibm-plex-mono) text-[13px] font-bold text-right self-center text-text-base">
        {current}
      </span>
      <span
        className="font-(family-name:--font-ibm-plex-mono) text-[13px] font-bold text-right self-center"
        style={{ color: simColor }}
      >
        {simulated}
      </span>
    </div>
  );
}
