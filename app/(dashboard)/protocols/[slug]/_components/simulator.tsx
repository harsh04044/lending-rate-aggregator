import { useMemo, useState } from "react";
import {
  CollateralAsset,
  DebtAsset,
  JuplendPairPosition,
  ProtocolDetail,
} from "../page";
import { C } from "@/src/lib/theme";
import { AssetSelectorButton, AmountInput, PremiumSlider } from "./common";
import { Title3 } from "@/src/components/ui/title-3";
import { Title4 } from "@/src/components/ui/title-4";
import { fmtUsd } from "@/src/lib";
import { LtvWarningBanner } from "@/src/components/ltv-warning-banner";
import { ActionButton } from "@/src/components/ui/action-button";
import { TokenIcon, TokenPairIcon } from "@/src/components/icons/token-icons";
import { simulateAction, type SimulateScope } from "@/src/lib/simulate";

// ── Top-level router ─────────────────────────────────────────────────────

export function SimulatorTab({ protocol }: { protocol: ProtocolDetail }) {
  if (protocol.slug === "juplend") {
    return <JuplendSimulator protocol={protocol} />;
  }
  return <PoolSimulator protocol={protocol} />;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseAmt(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseUsd(s: string): number {
  return parseFloat(s.replace(/[^0-9.\-]/g, "")) || 0;
}

function parseLeadingNumber(s: string): number {
  const m = s.match(/-?\d*\.?\d+/);
  return m ? parseFloat(m[0]) : 0;
}

function priceOfDebt(d: DebtAsset): number {
  return d.borrowed > 0 ? d.valueNum / d.borrowed : 0;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function safeWithdrawCap(
  asset: CollateralAsset,
  protocol: ProtocolDetail,
): number {
  // Don't let the user withdraw past the protocol's max LTV. Returns the
  // max number of asset units they can pull while keeping LTV ≤ maxLTV.
  if (protocol.maxLTV == null || protocol.maxLTV <= 0) return asset.balance;
  if (protocol.totalDebtNum <= 0) return asset.balance;
  const minCollateralUsd = (protocol.totalDebtNum / protocol.maxLTV) * 100;
  const headroomUsd = Math.max(
    0,
    protocol.totalCollateralNum - minCollateralUsd,
  );
  if (asset.price <= 0) return Math.min(asset.balance, 0);
  return Math.min(asset.balance, headroomUsd / asset.price);
}

function maxBorrowOf(asset: DebtAsset, protocol: ProtocolDetail): number {
  // Headroom in USD from current LTV to maxLTV, converted into this asset's
  // units. Returns 0 if at/over the cap.
  if (protocol.maxLTV == null) return 0;
  const capUsd = (protocol.totalCollateralNum * protocol.maxLTV) / 100;
  const headroomUsd = Math.max(0, capUsd - protocol.totalDebtNum);
  const px = priceOfDebt(asset);
  return px > 0 ? headroomUsd / px : 0;
}

// ── Pool simulator ───────────────────────────────────────────────────────

function PoolSimulator({ protocol }: { protocol: ProtocolDetail }) {
  const [colSym, setColSym] = useState(
    protocol.collateralAssets[0]?.symbol ?? "",
  );
  const [debtSym, setDebtSym] = useState(protocol.debtAssets[0]?.symbol ?? "");
  const [supply, setSupply] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [borrow, setBorrow] = useState("");
  const [repay, setRepay] = useState("");

  const hasCollateral = protocol.collateralAssets.length > 0;
  const hasDebt = protocol.debtAssets.length > 0;

  if (!hasCollateral && !hasDebt) {
    return (
      <div className="rounded-lg border bg-white/2 border-border-base py-10 text-center text-[13px] text-text-muted">
        No active position to simulate.
      </div>
    );
  }

  const colAsset =
    protocol.collateralAssets.find((a) => a.symbol === colSym) ??
    protocol.collateralAssets[0];
  const debtAsset =
    protocol.debtAssets.find((a) => a.symbol === debtSym) ??
    protocol.debtAssets[0];

  const colPrice = colAsset?.price ?? 0;
  const debtPrice = debtAsset ? priceOfDebt(debtAsset) : 0;

  const collateralDeltaUsd = (parseAmt(supply) - parseAmt(withdraw)) * colPrice;
  const debtDeltaUsd = (parseAmt(borrow) - parseAmt(repay)) * debtPrice;

  const sim = simulateAction(protocol, {
    collateralDeltaUsd,
    debtDeltaUsd,
  });

  const hasInput =
    parseAmt(supply) > 0 ||
    parseAmt(withdraw) > 0 ||
    parseAmt(borrow) > 0 ||
    parseAmt(repay) > 0;

  function reset() {
    setSupply("");
    setWithdraw("");
    setBorrow("");
    setRepay("");
  }

  const supplyMax = colAsset?.balance ?? 0; // wallet balance — TODO INTEGRATION
  const withdrawMax = colAsset ? safeWithdrawCap(colAsset, protocol) : 0;
  const borrowMax = debtAsset ? maxBorrowOf(debtAsset, protocol) : 0;
  const repayMax = debtAsset?.borrowed ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {/* ── Sides ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Collateral side */}
        {hasCollateral && colAsset && (
          <SidePanel title="Collateral">
            {protocol.collateralAssets.length > 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {protocol.collateralAssets.map((a) => (
                  <AssetSelectorButton
                    key={a.symbol}
                    symbol={a.symbol}
                    meta={a.balanceStr}
                    active={a.symbol === colAsset.symbol}
                    onClick={() => {
                      setColSym(a.symbol);
                      setSupply("");
                      setWithdraw("");
                    }}
                  />
                ))}
              </div>
            )}
            <SignedAction
              label="Supply"
              symbol={colAsset.symbol}
              logoUrl={colAsset.logoUrl}
              value={supply}
              onChange={setSupply}
              max={supplyMax}
              approxUsd={fmtUsd(parseAmt(supply) * colPrice)}
              hint="Wallet balance —"
            />
            <SignedAction
              label="Withdraw"
              symbol={colAsset.symbol}
              logoUrl={colAsset.logoUrl}
              value={withdraw}
              onChange={setWithdraw}
              max={withdrawMax}
              approxUsd={fmtUsd(parseAmt(withdraw) * colPrice)}
              hint={`Supplied ${colAsset.balanceStr} (safe ${withdrawMax.toFixed(2)})`}
            />
          </SidePanel>
        )}

        {/* Debt side */}
        {hasDebt && debtAsset && (
          <SidePanel title="Debt">
            {protocol.debtAssets.length > 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {protocol.debtAssets.map((a) => (
                  <AssetSelectorButton
                    key={a.symbol}
                    symbol={a.symbol}
                    meta={a.borrowedStr}
                    active={a.symbol === debtAsset.symbol}
                    onClick={() => {
                      setDebtSym(a.symbol);
                      setBorrow("");
                      setRepay("");
                    }}
                  />
                ))}
              </div>
            )}
            <SignedAction
              label="Repay"
              symbol={debtAsset.symbol}
              logoUrl={debtAsset.logoUrl}
              value={repay}
              onChange={setRepay}
              max={repayMax}
              approxUsd={fmtUsd(parseAmt(repay) * debtPrice)}
              hint={`Borrowed ${debtAsset.borrowedStr}`}
            />
            <SignedAction
              label="Borrow"
              symbol={debtAsset.symbol}
              logoUrl={debtAsset.logoUrl}
              value={borrow}
              onChange={setBorrow}
              max={borrowMax}
              approxUsd={fmtUsd(parseAmt(borrow) * debtPrice)}
              hint={`Headroom ${borrowMax.toFixed(2)} ${debtAsset.symbol}`}
            />
          </SidePanel>
        )}
      </div>

      {/* ── Comparison table ── */}
      <ComparisonCard sim={sim} maxLtv={protocol.maxLTV} hasInput={hasInput} />

      {/* ── LTV warning ── */}
      {hasInput && sim.ltvExceeded && protocol.maxLTV != null && (
        <LtvWarningBanner
          requiredLtv={fmtPct(sim.newLTV)}
          maxLtv={protocol.maxLTV}
          protocolName={protocol.name}
          collateral={colAsset?.symbol ?? ""}
          debt={debtAsset?.symbol ?? ""}
          onReduceBorrow={() => setBorrow("")}
        />
      )}

      {/* ── Footer ── */}
      <SimulatorFooter
        onReset={reset}
        disabled={
          !hasInput ||
          sim.ltvExceeded ||
          sim.collateralWentNegative ||
          sim.debtWentNegative
        }
      />
    </div>
  );
}

// ── JupLend simulator ────────────────────────────────────────────────────

interface PairInputs {
  supply: string;
  withdraw: string;
  borrow: string;
  repay: string;
}

const EMPTY_PAIR_INPUTS: PairInputs = {
  supply: "",
  withdraw: "",
  borrow: "",
  repay: "",
};

function JuplendSimulator({ protocol }: { protocol: ProtocolDetail }) {
  const [perPair, setPerPair] = useState<Record<string, PairInputs>>({});

  // Per-pair simulations + aggregate deltas.
  const { perPairSims, aggregateDelta, anyInput } = useMemo(() => {
    const sims = protocol.pairs.map((pair) => {
      const inputs = perPair[pair.id] ?? EMPTY_PAIR_INPUTS;
      const colPrice = pairColPrice(pair);
      const debtPrice = pairDebtPrice(pair);
      const colDelta =
        (parseAmt(inputs.supply) - parseAmt(inputs.withdraw)) * colPrice;
      const debtDelta =
        (parseAmt(inputs.borrow) - parseAmt(inputs.repay)) * debtPrice;
      const scope = scopeFromPair(pair);
      const sim = simulateAction(protocol, {
        collateralDeltaUsd: colDelta,
        debtDeltaUsd: debtDelta,
        scope,
      });
      const pairHasInput =
        parseAmt(inputs.supply) > 0 ||
        parseAmt(inputs.withdraw) > 0 ||
        parseAmt(inputs.borrow) > 0 ||
        parseAmt(inputs.repay) > 0;
      return { pair, inputs, sim, colDelta, debtDelta, pairHasInput };
    });

    const totalColDelta = sims.reduce((acc, s) => acc + s.colDelta, 0);
    const totalDebtDelta = sims.reduce((acc, s) => acc + s.debtDelta, 0);
    const anyInput = sims.some((s) => s.pairHasInput);

    return {
      perPairSims: sims,
      aggregateDelta: {
        collateralDeltaUsd: totalColDelta,
        debtDeltaUsd: totalDebtDelta,
      },
      anyInput,
    };
  }, [protocol, perPair]);

  if (protocol.pairs.length === 0) {
    return (
      <div className="rounded-lg border bg-white/2 border-border-base py-10 text-center text-[13px] text-text-muted">
        No JupLend obligations to simulate.
      </div>
    );
  }

  function updatePair(id: string, patch: Partial<PairInputs>) {
    setPerPair((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? EMPTY_PAIR_INPUTS), ...patch },
    }));
  }

  // Protocol-wide simulation for the "Overall" summary card.
  const aggregateSim = simulateAction(protocol, aggregateDelta);

  function reset() {
    setPerPair({});
  }

  const anyInvalid = perPairSims.some(
    ({ sim }) =>
      sim.ltvExceeded || sim.collateralWentNegative || sim.debtWentNegative,
  );

  return (
    <div className="flex flex-col gap-8">
      {/* ── Aggregate summary ── */}
      <ComparisonCard
        title="Overall (USD-weighted across pairs)"
        sim={aggregateSim}
        maxLtv={protocol.maxLTV}
        hasInput={anyInput}
      />

      {/* ── Per-pair cards ── */}
      <section className="space-y-3">
        <Title3 text="Per-Pair Adjustments" />
        <div className="flex flex-col gap-3">
          {perPairSims.map(({ pair, inputs, sim }) => (
            <PairSimCard
              key={pair.id}
              pair={pair}
              inputs={inputs}
              sim={sim}
              onChange={(patch) => updatePair(pair.id, patch)}
            />
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <SimulatorFooter onReset={reset} disabled={!anyInput || anyInvalid} />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function SidePanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-6 bg-white/2 border-border-base">
      <div className="mb-4">
        <Title3 text={title} />
      </div>
      {children}
    </div>
  );
}

function SignedAction({
  label,
  symbol,
  logoUrl,
  value,
  onChange,
  max,
  approxUsd,
  hint,
}: {
  label: string;
  symbol: string;
  logoUrl?: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  approxUsd: string;
  hint: string;
}) {
  const numeric = parseAmt(value);
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <TokenIcon symbol={symbol} logoUrl={logoUrl} size={18} />
          <Title4 text={`${label} (${symbol})`} />
        </div>
        <span className="font-(family-name:--font-dm-sans) text-[11px] text-text-muted">
          {hint}
        </span>
      </div>
      <AmountInput
        value={value}
        onChange={onChange}
        max={max > 0 ? max : undefined}
        approxUsd={numeric > 0 ? approxUsd : undefined}
        onMax={() => onChange(max > 0 ? String(max) : "")}
      />
      {max > 0 && (
        <PremiumSlider
          value={numeric}
          max={max}
          onChange={(v) => onChange(v > 0 ? String(v) : "")}
        />
      )}
    </div>
  );
}

function ComparisonCard({
  title = "Current vs Simulated",
  sim,
  maxLtv,
  hasInput,
}: {
  title?: string;
  sim: ReturnType<typeof simulateAction>;
  maxLtv: number | null;
  hasInput: boolean;
}) {
  const maxLtvStr = maxLtv != null ? fmtPct(maxLtv) : "—";
  return (
    <div className="rounded-lg border p-6 bg-white/2 border-border-base">
      <div className="mb-4">
        <Title3 text={title} />
      </div>
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
      <CompRow
        label="Collateral"
        current={fmtUsd(sim.currentCollateralUsd)}
        simulated={fmtUsd(Math.max(0, sim.newCollateralUsd))}
        active={hasInput}
        tone={
          sim.newCollateralUsd > sim.currentCollateralUsd
            ? "up"
            : sim.newCollateralUsd < sim.currentCollateralUsd
              ? "down"
              : "neutral"
        }
      />
      <CompRow
        label="Debt"
        current={fmtUsd(sim.currentDebtUsd)}
        simulated={fmtUsd(Math.max(0, sim.newDebtUsd))}
        active={hasInput}
        tone={
          sim.newDebtUsd < sim.currentDebtUsd
            ? "up"
            : sim.newDebtUsd > sim.currentDebtUsd
              ? "down"
              : "neutral"
        }
      />
      <CompRow
        label="LTV"
        current={fmtPct(sim.currentLTV)}
        simulated={fmtPct(sim.newLTV)}
        active={hasInput}
        tone={sim.ltvDelta > 0 ? "down" : sim.ltvDelta < 0 ? "up" : "neutral"}
      />
      <CompRow
        label="Max LTV"
        current={maxLtvStr}
        simulated={maxLtvStr}
        active={false}
      />
      <CompRow
        label="Health"
        current={fmtPct(sim.currentHealth)}
        simulated={fmtPct(sim.newHealth)}
        active={hasInput}
        tone={
          sim.healthDelta > 0 ? "up" : sim.healthDelta < 0 ? "down" : "neutral"
        }
      />
      <CompRow
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
        tone={
          sim.liqDistanceCurrent != null && sim.liqDistanceNew != null
            ? sim.liqDistanceNew > sim.liqDistanceCurrent
              ? "up"
              : sim.liqDistanceNew < sim.liqDistanceCurrent
                ? "down"
                : "neutral"
            : "neutral"
        }
        last
      />
    </div>
  );
}

function CompRow({
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
    !active || tone === undefined || tone === "neutral"
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

function PairSimCard({
  pair,
  inputs,
  sim,
  onChange,
}: {
  pair: JuplendPairPosition;
  inputs: PairInputs;
  sim: ReturnType<typeof simulateAction>;
  onChange: (patch: Partial<PairInputs>) => void;
}) {
  const ltvTone =
    pair.maxLTV != null && sim.newLTV > pair.maxLTV
      ? C.red
      : sim.ltvDelta > 0
        ? C.yellow
        : sim.ltvDelta < 0
          ? C.accent
          : C.text;

  const collateralBalance = parseLeadingNumber(pair.collateralAmountStr);
  const debtBalance = parseLeadingNumber(pair.debtAmountStr);

  return (
    <div className="rounded-lg border p-5 bg-white/2 border-border-base">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <TokenPairIcon
            collateralSymbol={pair.collateralSymbol}
            debtSymbol={pair.debtSymbol}
            collateralLogoUrl={pair.collateralLogoUrl}
            debtLogoUrl={pair.debtLogoUrl}
            size={26}
          />
          <div className="flex flex-col">
            <span className="font-(family-name:--font-ibm-plex-mono) text-[14px] font-bold text-text-base">
              {pair.collateralSymbol} / {pair.debtSymbol}
            </span>
            <span className="font-(family-name:--font-ibm-plex-mono) text-[11.5px] font-semibold text-text-muted">
              {pair.collateralAmountStr} / {pair.debtAmountStr}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <PairBadge
            label="LTV"
            current={fmtPct(pair.ltv)}
            simulated={fmtPct(sim.newLTV)}
            simColor={ltvTone}
          />
          <PairBadge
            label="Health"
            current={`${pair.health}%`}
            simulated={fmtPct(sim.newHealth)}
            simColor={
              sim.healthDelta > 0
                ? C.accent
                : sim.healthDelta < 0
                  ? C.red
                  : C.text
            }
          />
        </div>
      </div>

      {/* 4 inputs */}
      <div className="grid grid-cols-2 gap-3">
        <PairMiniInput
          label={`Supply (${pair.collateralSymbol})`}
          symbol={pair.collateralSymbol}
          logoUrl={pair.collateralLogoUrl}
          value={inputs.supply}
          onChange={(v) => onChange({ supply: v })}
        />
        <PairMiniInput
          label={`Borrow (${pair.debtSymbol})`}
          symbol={pair.debtSymbol}
          logoUrl={pair.debtLogoUrl}
          value={inputs.borrow}
          onChange={(v) => onChange({ borrow: v })}
        />
        <PairMiniInput
          label={`Withdraw (${pair.collateralSymbol})`}
          symbol={pair.collateralSymbol}
          logoUrl={pair.collateralLogoUrl}
          value={inputs.withdraw}
          onChange={(v) => onChange({ withdraw: v })}
          max={collateralBalance}
        />
        <PairMiniInput
          label={`Repay (${pair.debtSymbol})`}
          symbol={pair.debtSymbol}
          logoUrl={pair.debtLogoUrl}
          value={inputs.repay}
          onChange={(v) => onChange({ repay: v })}
          max={debtBalance}
        />
      </div>

      {/* Validation */}
      {sim.ltvExceeded && (
        <div className="mt-3 text-[12px] font-semibold text-danger">
          New LTV exceeds this pair&apos;s max LTV (
          {pair.maxLTV != null ? fmtPct(pair.maxLTV) : "—"}).
        </div>
      )}
    </div>
  );
}

function PairBadge({
  label,
  current,
  simulated,
  simColor,
}: {
  label: string;
  current: string;
  simulated: string;
  simColor: string;
}) {
  return (
    <div className="flex flex-col items-end">
      <span className="font-(family-name:--font-dm-sans) text-[10px] font-semibold uppercase tracking-widest text-text-muted">
        {label}
      </span>
      <span className="font-(family-name:--font-ibm-plex-mono) text-[12px] font-semibold">
        <span className="text-text-base">{current}</span>
        <span className="text-text-muted mx-1">→</span>
        <span style={{ color: simColor }}>{simulated}</span>
      </span>
    </div>
  );
}

function PairMiniInput({
  label,
  symbol,
  logoUrl,
  value,
  onChange,
  max,
}: {
  label: string;
  symbol: string;
  logoUrl?: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
}) {
  return (
    <div>
      <div className="mb-1.5">
        <Title4 text={label} />
      </div>
      <div className="flex items-center gap-2 px-3 h-11 rounded-md bg-surface-2 border border-border-base">
        <TokenIcon symbol={symbol} logoUrl={logoUrl} size={18} />
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
          }}
          className="flex-1 min-w-0 bg-transparent font-(family-name:--font-ibm-plex-mono) text-[14px] font-semibold outline-none placeholder:opacity-30 text-text-base"
        />
        {max !== undefined && max > 0 && (
          <button
            type="button"
            onClick={() => onChange(String(max))}
            className="font-(family-name:--font-dm-sans) text-[10.5px] tracking-[0.18em] font-bold uppercase text-text-muted hover:text-accent transition-colors cursor-pointer"
          >
            Max
          </button>
        )}
      </div>
    </div>
  );
}

function SimulatorFooter({
  onReset,
  disabled,
}: {
  onReset: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onReset}
        className="font-(family-name:--font-dm-sans) text-[12.5px] font-bold px-5 py-2.5 rounded-md border-[1.5px] cursor-pointer"
        style={{
          color: C.textMuted,
          background: "transparent",
          borderColor: C.border,
          transition: "all 160ms ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = C.borderLit;
          (e.currentTarget as HTMLElement).style.color = C.textSec;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = C.border;
          (e.currentTarget as HTMLElement).style.color = C.textMuted;
        }}
      >
        Reset Simulation
      </button>
      {/* TODO INTEGRATION: wire to tx-build endpoints once backend supports it. */}
      <ActionButton disabled={disabled}>Apply Changes</ActionButton>
    </div>
  );
}

// ── Pair-scope helpers ───────────────────────────────────────────────────

function pairColPrice(pair: JuplendPairPosition): number {
  const usd = parseUsd(pair.collateralValueUsd);
  const amt = parseLeadingNumber(pair.collateralAmountStr);
  return amt > 0 ? usd / amt : 0;
}

function pairDebtPrice(pair: JuplendPairPosition): number {
  const usd = parseUsd(pair.debtValueUsd);
  const amt = parseLeadingNumber(pair.debtAmountStr);
  return amt > 0 ? usd / amt : 0;
}

function scopeFromPair(pair: JuplendPairPosition): SimulateScope {
  return {
    currentCollateralUsd: parseUsd(pair.collateralValueUsd),
    currentDebtUsd: parseUsd(pair.debtValueUsd),
    currentLTV: pair.ltv,
    maxLTV: pair.maxLTV,
    liqThreshold: pair.liqThreshold,
  };
}
