import { C } from "@/src/lib/theme";
import { ProtocolDetail } from "../page";
import { Activity, useState } from "react";
import { TokenIcon } from "@/src/components/icons/token-icons";
import { AmountInput, CompactMetricCard, PremiumSlider } from "./common";
import { ActionButton } from "@/src/components/ui/action-button";
import { ArrowRight, DollarSign, Heart } from "lucide-react";
import { fmtUsd } from "@/src/lib";

export function ClearTab({ protocol }: { protocol: ProtocolDetail }) {
  const [repayAmounts, setRepayAmounts] = useState<Record<string, number>>(
    () => {
      const init: Record<string, number> = {};
      protocol.debtAssets.forEach((d) => {
        init[d.symbol] = 0;
      });
      return init;
    },
  );

  // No collateral / no risk params, nothing to repay against. Bail early.
  if (protocol.maxLTV == null || protocol.debtAssets.length === 0) {
    return (
      <div className="rounded-lg border bg-white/2 border-border-base py-10 text-center text-[13px] text-text-muted">
        No outstanding debt on this protocol.
      </div>
    );
  }

  const maxLTV = protocol.maxLTV;

  const totalRepayUsd = protocol.debtAssets.reduce((sum, d) => {
    const price = d.valueNum / d.borrowed;
    return sum + (repayAmounts[d.symbol] || 0) * price;
  }, 0);

  const remainingDebt = protocol.totalDebtNum - totalRepayUsd;
  const newLTV =
    protocol.totalCollateralNum > 0
      ? Math.max(0, (remainingDebt / protocol.totalCollateralNum) * 100)
      : 0;
  const newHealth =
    newLTV > 0 ? Math.min(100, (maxLTV / newLTV) * 100) : 100;
  const monthlySavings = protocol.debtAssets.reduce((sum, d) => {
    const price = d.valueNum / d.borrowed;
    const repayUsd = (repayAmounts[d.symbol] || 0) * price;
    return sum + (repayUsd * d.borrowAPR) / 100 / 12;
  }, 0);

  const healthColor =
    newHealth > 70 ? C.accent : newHealth > 40 ? C.yellow : C.red;
  const ltvColor =
    newLTV < maxLTV * 0.5
      ? C.accent
      : newLTV < maxLTV * 0.8
        ? C.yellow
        : C.red;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-3">
        <CompactMetricCard
          icon={Heart}
          label="Health After"
          value={`${Math.round(newHealth)}%`}
          sub={`Previously ${protocol.safetyScore}%`}
          valueColor={healthColor}
        />
        <CompactMetricCard
          icon={Activity}
          label="LTV After"
          value={`${newLTV.toFixed(1)}%`}
          sub={`Previously ${protocol.currentLTV}%`}
          valueColor={ltvColor}
        />
        <CompactMetricCard
          icon={DollarSign}
          label="Monthly Savings"
          value={`+${fmtUsd(monthlySavings)}/mo`}
          sub="Borrow cost reduction"
          valueColor={C.accent}
        />
      </div>

      {protocol.debtAssets.map((debt) => {
        const repayAmt = repayAmounts[debt.symbol] || 0;
        const price = debt.valueNum / debt.borrowed;
        const repayUsd = repayAmt * price;
        const hasValue = repayAmt > 0;
        return (
          <div
            key={debt.symbol}
            className="rounded-lg border p-5 bg-white/2 border-border-base"
          >
            <div className="flex items-center gap-1.5 mb-5">
              <TokenIcon symbol={debt.symbol} size={28} />
              <div>
                <span className="text-[16px] font-bold text-text-base">
                  {debt.symbol}
                </span>
                <span className="text-[12.5px] font-semibold ml-2 text-text-muted">
                  Outstanding: {debt.borrowedStr}
                </span>
              </div>
            </div>

            <AmountInput
              value={repayAmt > 0 ? repayAmt.toString() : ""}
              onChange={(raw) =>
                setRepayAmounts((prev) => ({
                  ...prev,
                  [debt.symbol]: parseFloat(raw) || 0,
                }))
              }
              max={debt.borrowed}
              approxUsd={fmtUsd(repayUsd)}
              onMax={() =>
                setRepayAmounts((prev) => ({
                  ...prev,
                  [debt.symbol]: debt.borrowed,
                }))
              }
            />

            <div className="mb-5">
              <PremiumSlider
                value={repayAmt}
                max={debt.borrowed}
                onChange={(v) =>
                  setRepayAmounts((prev) => ({ ...prev, [debt.symbol]: v }))
                }
              />
            </div>

            <div className="flex justify-end">
              <ActionButton
                disabled={!hasValue}
                trailingIcon={<ArrowRight size={16} strokeWidth={2.5} />}
              >
                Repay Debt
              </ActionButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}
