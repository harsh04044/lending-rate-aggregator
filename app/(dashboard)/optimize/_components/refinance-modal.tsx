"use client";

import { useEffect, useRef, useState } from "react";
import { ProtocolIcon, TokenIcon } from "@/src/components/icons/token-icons";
import { Title3 } from "@/src/components/ui/title-3";
import { Title4 } from "@/src/components/ui/title-4";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { MainCard } from "@/src/components/main-card";
import { ActionButton } from "@/src/components/ui/action-button";
import { LtvWarningBanner } from "@/src/components/ltv-warning-banner";
import { fmtUsd } from "@/src/lib";
import { COLORS } from "@/src/lib/theme";
import { toast } from "@/src/lib/toast";
import type { SentTx } from "@/src/lib/tx/send";
import { GENERIC_TX_FAILURE_MESSAGE } from "@/src/lib/tx/action-errors";

export interface RefinanceModalAsset {
  symbol: string;
  amount: number;
  usd: number;
  logoUrl?: string;
}

export interface RefinanceModalProto {
  name: string;
  maxLTV: number | null;
  supplyApy: number | null;
  borrowApy: number | null;
}

export interface RefinanceMigrateArgs {
  colNum: number;
  debtNum: number;
  isMax: boolean;
  isCollateralMax: boolean;
  isDebtMax: boolean;
}

export function RefinanceModal({
  fromProto,
  toProto,
  initialCollateral,
  initialDebt,
  siblingDebts = [],
  fromMaxLTV = null,
  onClose,
  onMigrate,
  onConfirmed,
}: {
  fromProto: RefinanceModalProto;
  toProto: RefinanceModalProto;
  initialCollateral: RefinanceModalAsset;
  initialDebt: RefinanceModalAsset | null;
  siblingDebts?: { symbol: string; amount: number; usd: number }[];
  fromMaxLTV?: number | null;
  onClose: () => void;
  onMigrate?: (args: RefinanceMigrateArgs) => Promise<SentTx>;
  onConfirmed?: () => void;
}) {
  const hasDebt = initialDebt !== null;
  const [colAmount, setColAmount] = useState(String(initialCollateral.amount));
  const [debtAmount, setDebtAmount] = useState(
    hasDebt ? String(initialDebt.amount) : "",
  );

  const colRef = useRef<HTMLInputElement>(null);
  const debtRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const colPrice =
    initialCollateral.amount > 0
      ? initialCollateral.usd / initialCollateral.amount
      : 0;
  const debtPrice =
    hasDebt && initialDebt.amount > 0
      ? initialDebt.usd / initialDebt.amount
      : 0;

  const colNum = parseFloat(colAmount) || 0;
  const debtNum = parseFloat(debtAmount) || 0;
  const colUsd = colNum * colPrice;
  const debtUsd = debtNum * debtPrice;

  const requiredLtvPct = hasDebt && colUsd > 0 ? (debtUsd / colUsd) * 100 : 0;
  const requiredLtv = Math.round(requiredLtvPct);
  const toMaxLTVRaw = toProto.maxLTV;
  const toMaxLTV = toMaxLTVRaw ?? 0;
  const toMaxLTVUnknown = hasDebt && (toMaxLTVRaw == null || toMaxLTVRaw <= 0);
  const ltvExceeded =
    hasDebt && toMaxLTVRaw != null && requiredLtvPct > toMaxLTVRaw;

  const remainingColAmount = Math.max(0, initialCollateral.amount - colNum);
  const remainingMigratedDebtAmount =
    hasDebt && initialDebt ? Math.max(0, initialDebt.amount - debtNum) : 0;
  const remainingColUsd = remainingColAmount * colPrice;
  const remainingMigratedDebtUsd = remainingMigratedDebtAmount * debtPrice;
  const remainingSiblingDebtUsd = siblingDebts.reduce(
    (sum, d) => sum + d.usd,
    0,
  );
  const remainingDebtUsd = remainingMigratedDebtUsd + remainingSiblingDebtUsd;
  const hasRemainingDebt = remainingDebtUsd > 0;
  const remainingLtvPct =
    remainingColUsd > 0 ? (remainingDebtUsd / remainingColUsd) * 100 : Infinity;
  const blockedByRemainingLtv =
    hasRemainingDebt &&
    fromMaxLTV != null &&
    fromMaxLTV > 0 &&
    remainingLtvPct > fromMaxLTV;

  const siblingDebtSummary = siblingDebts
    .map((d) => `${d.amount.toFixed(2)} ${d.symbol}`)
    .join(", ");
  const fromMaxLTVDisplay =
    fromMaxLTV != null ? Math.round(fromMaxLTV) : fromMaxLTV;
  const remainingLtvMessage = blockedByRemainingLtv
    ? siblingDebts.length > 0
      ? `Your remaining ${fromProto.name} position (including ${siblingDebtSummary}) would exceed ${fromProto.name}'s max LTV (${fromMaxLTVDisplay}%). Reduce collateral, or migrate the other debt too.`
      : `Migrating these amounts would leave your remaining ${fromProto.name} position above its max LTV (${fromMaxLTVDisplay}%). Reduce collateral or migrate more debt.`
    : null;

  const canConfirm =
    colNum > 0 &&
    (hasDebt ? debtNum > 0 && !ltvExceeded && !toMaxLTVUnknown : true) &&
    !blockedByRemainingLtv;

  const ltvRatio = toMaxLTV > 0 ? requiredLtv / toMaxLTV : 0;
  const ltvColor = ltvExceeded
    ? "#E5A93E"
    : ltvRatio < 0.5
      ? COLORS.primary
      : ltvRatio < 0.8
        ? "#E5A93E"
        : "#E5534B";

  const fromBorrow = fromProto.borrowApy ?? 0;
  const toBorrow = toProto.borrowApy ?? 0;
  const toSupply = toProto.supplyApy ?? 0;

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleMigrate() {
    if (!onMigrate || !canConfirm) return;

    const isCollateralMax = colNum >= initialCollateral.amount;
    const isDebtMax =
      !hasDebt || (initialDebt != null && debtNum >= initialDebt.amount);
    const isMax = isCollateralMax && isDebtMax;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const sent = await onMigrate({
        colNum,
        debtNum,
        isMax,
        isCollateralMax,
        isDebtMax,
      });
      const label = `Migrate to ${toProto.name}`;
      toast.promise(
        sent.confirm.then(() => onConfirmed?.()),
        {
          loading: `${label}…`,
          success: `${label} successful.`,
          error: (err: unknown) => {
            console.error("[RefinanceModal] confirm failed:", err);
            return GENERIC_TX_FAILURE_MESSAGE;
          },
        },
      );
      onClose();
    } catch (err: unknown) {
      console.error("[RefinanceModal] migration failed:", err);
      setSubmitError(GENERIC_TX_FAILURE_MESSAGE);
      toast.error(GENERIC_TX_FAILURE_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  const estNetApr = hasDebt ? toSupply - toBorrow : toSupply;
  const savingsVsFrom = fromBorrow - toBorrow;
  const monthlySavings =
    hasDebt && savingsVsFrom > 0 ? ((savingsVsFrom / 100) * debtUsd) / 12 : 0;

  function handleReduceDebt() {
    if (colUsd > 0 && toMaxLTV > 0) {
      const safeDebtUsd = colUsd * (toMaxLTV / 100) * 0.9;
      const safeDebtAmt = debtPrice > 0 ? safeDebtUsd / debtPrice : 0;
      setDebtAmount(safeDebtAmt.toFixed(2));
    }
    debtRef.current?.focus();
  }

  function handleAddCollateral() {
    if (debtUsd > 0 && toMaxLTV > 0) {
      const requiredColUsd = (debtUsd / (toMaxLTV / 100)) * 1.1;
      const requiredColAmt = colPrice > 0 ? requiredColUsd / colPrice : 0;
      setColAmount(requiredColAmt.toFixed(2));
    }
    colRef.current?.focus();
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md p-4 sm:p-6">
      <div className="absolute inset-0 bg-surface-0/72" onClick={onClose} />

      <MainCard className="overflow-y-auto max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-80px)] custom-scrollbar p-5! sm:p-7.5! bg-white/2! w-full sm:w-auto">
        <div className="">
          <div className="flex items-start justify-between mb-8">
            <div className="flex items-center gap-4">
              <ProtocolIcon name={toProto.name} size={38} />
              <Title3 text={`Migrate to ${toProto.name}`} />
            </div>
            <X
              size={25}
              strokeWidth={2}
              onClick={onClose}
              className="cursor-pointer text-text-muted"
            />
          </div>

          <div
            className={`grid gap-5 mb-6 ${hasDebt ? "grid-cols-2" : "grid-cols-1"}`}
          >
            <div>
              <div className="mb-2">
                <Title4 text={`Collateral (${initialCollateral.symbol})`} />
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                <TokenIcon
                  symbol={initialCollateral.symbol}
                  logoUrl={initialCollateral.logoUrl}
                  size={24}
                />
                <input
                  ref={colRef}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={colAmount}
                  onChange={(e) => setColAmount(e.target.value)}
                  className="flex-1 bg-transparent font-(family-name:--font-ibm-plex-mono) text-[18px] font-medium outline-none placeholder:opacity-30 text-text-base"
                />
                <button
                  type="button"
                  onClick={() => setColAmount(String(initialCollateral.amount))}
                  className="p-2 cursor-pointer bg-surface-2 rounded-sm font-(family-name:--font-dm-sans) text-[12px] font-bold shrink-0 text-text-muted"
                >
                  MAX
                </button>
              </div>
              {colNum > 0 && (
                <p className="font-(family-name:--font-ibm-plex-mono) text-[12px] mt-1.5 px-1 font-semibold text-text-muted">
                  ≈ {fmtUsd(colUsd)}
                </p>
              )}
            </div>

            {hasDebt && initialDebt && (
              <div>
                <div className="mb-2">
                  <Title4 text={`Debt (${initialDebt.symbol})`} />
                </div>
                <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                  <TokenIcon
                    symbol={initialDebt.symbol}
                    logoUrl={initialDebt.logoUrl}
                    size={24}
                  />
                  <input
                    ref={debtRef}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={debtAmount}
                    onChange={(e) => setDebtAmount(e.target.value)}
                    className="flex-1 bg-transparent font-(family-name:--font-ibm-plex-mono) text-[18px] font-medium outline-none placeholder:opacity-30 text-text-base"
                  />
                  <button
                    type="button"
                    onClick={() => setDebtAmount(String(initialDebt.amount))}
                    className="p-2 cursor-pointer bg-surface-2 rounded-sm font-(family-name:--font-dm-sans) text-[12px] font-bold shrink-0 text-text-muted"
                  >
                    MAX
                  </button>
                </div>
                {debtNum > 0 && (
                  <p className="font-(family-name:--font-ibm-plex-mono) text-[12px] mt-1.5 px-1 font-semibold text-text-muted">
                    ≈ {fmtUsd(debtUsd)}
                  </p>
                )}
              </div>
            )}
          </div>

          <div
            className={`grid gap-4 mb-6 ${hasDebt ? "grid-cols-3" : "grid-cols-2"}`}
          >
            {hasDebt && (
              <div className="px-4 py-3 rounded-lg bg-surface-2">
                <div className="mb-1">
                  <Title4 text="Current LTV" />
                </div>
                <span
                  className="font-(family-name:--font-ibm-plex-mono) text-[22px] font-bold leading-none"
                  style={{ color: ltvColor }}
                >
                  {requiredLtv}%
                </span>
              </div>
            )}
            {hasDebt && (
              <div className="px-4 py-3 rounded-lg bg-surface-2">
                <div className="mb-1">
                  <Title4 text={`${toProto.name} Max LTV`} />
                </div>
                <span className="font-(family-name:--font-ibm-plex-mono) text-[22px] font-bold leading-none text-text-dim">
                  {toMaxLTV.toFixed(1)}%
                </span>
              </div>
            )}
            <div className="px-4 py-3 rounded-lg bg-surface-2">
              <div className="mb-1">
                <Title4 text={hasDebt ? "Est. Net APR" : "Supply APY"} />
              </div>
              <span
                className={`font-(family-name:--font-ibm-plex-mono) text-[22px] font-bold leading-none ${estNetApr >= 0 ? "text-accent" : "text-danger"}`}
              >
                {estNetApr >= 0 ? "+" : ""}
                {estNetApr.toFixed(2)}%
              </span>
            </div>
            {!hasDebt && (
              <div className="px-4 py-3 rounded-lg bg-surface-2">
                <div className="mb-1">
                  <Title4 text="Collateral Value" />
                </div>
                <span className="font-(family-name:--font-ibm-plex-mono) text-[22px] font-bold leading-none text-text-base">
                  {fmtUsd(colUsd)}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg bg-surface-2 px-5 py-4 mb-6">
            <div className="flex items-center justify-between mb-2.5">
              <Title4 text={`Supply APY (${toSupply.toFixed(2)}%)`} />
              <span className="font-(family-name:--font-ibm-plex-mono) text-[12px] font-semibold text-accent">
                +${((colUsd * toSupply) / 100 / 365).toFixed(2)}/day
              </span>
            </div>
            {hasDebt && (
              <div className="flex items-center justify-between mb-2.5">
                <Title4 text={`Borrow APR (${toBorrow.toFixed(2)}%)`} />
                <span className="font-(family-name:--font-ibm-plex-mono) text-[12px] font-semibold text-danger">
                  -${((debtUsd * toBorrow) / 100 / 365).toFixed(2)}
                  /day
                </span>
              </div>
            )}
            <div className="h-px my-2.5 bg-border-base" />
            <div className="flex items-center justify-between">
              <span className="font-(family-name:--font-dm-sans) text-[12px] font-semibold text-text-base">
                {hasDebt
                  ? `Est. Monthly Savings vs ${fromProto.name}`
                  : "Collateral-only transfer"}
              </span>
              <span
                className={`font-(family-name:--font-ibm-plex-mono) text-[13px] font-semibold ${
                  hasDebt && monthlySavings > 0
                    ? "text-accent"
                    : "text-text-dim"
                }`}
              >
                {hasDebt
                  ? `${monthlySavings > 0 ? "+" : ""}${fmtUsd(monthlySavings)}/mo`
                  : "No debt"}
              </span>
            </div>
          </div>

          {ltvExceeded && hasDebt && initialDebt && (
            <LtvWarningBanner
              requiredLtv={`${requiredLtv.toFixed(1)}%`}
              maxLtv={toMaxLTV}
              protocolName={toProto.name}
              collateral={initialCollateral.symbol}
              debt={initialDebt.symbol}
              title={`Position exceeds ${toProto.name}'s supported LTV`}
              onReduceBorrow={handleReduceDebt}
              onAddCollateral={handleAddCollateral}
            />
          )}

          {remainingLtvMessage && (
            <div className="rounded-md bg-warn/10 border border-warn/25 px-4 py-2.5 mb-6 font-(family-name:--font-dm-sans) text-[12px] font-semibold text-warn wrap-break-words">
              {remainingLtvMessage}
            </div>
          )}

          {toMaxLTVUnknown && (
            <div className="rounded-md bg-warn/10 border border-warn/25 px-4 py-2.5 mb-6 font-(family-name:--font-dm-sans) text-[12px] font-semibold text-warn wrap-break-words">
              {`${toProto.name}'s max LTV for this pair isn't available right now. Try again in a moment, or pick a different destination.`}
            </div>
          )}

          {submitError && (
            <div className="rounded-md bg-danger/10 border border-danger/25 px-4 py-2.5 mb-6 font-(family-name:--font-dm-sans) text-[12px] font-semibold text-danger wrap-break-words">
              {submitError}
            </div>
          )}

          <div className="flex items-center justify-between mt-8">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md font-(family-name:--font-dm-sans) text-[12.5px] font-medium cursor-pointer text-text-muted bg-surface-2 disabled:opacity-60"
            >
              <ArrowLeft size={13} strokeWidth={1.8} />
              Cancel
            </button>

            <ActionButton
              disabled={!canConfirm || !onMigrate || submitting}
              onClick={handleMigrate}
              trailingIcon={
                submitting ? undefined : (
                  <ArrowRight size={16} strokeWidth={2.5} />
                )
              }
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Submitting…
                </span>
              ) : (
                "Migrate Position"
              )}
            </ActionButton>
          </div>
        </div>
      </MainCard>
    </div>
  );
}
