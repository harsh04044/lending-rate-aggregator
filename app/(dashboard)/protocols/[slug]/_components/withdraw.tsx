import { useState } from "react";
import { ProtocolDetail } from "../page";
import { C } from "@/src/lib/theme";
import { TokenIcon } from "@/src/components/icons/token-icons";
import {
  AmountInput,
  AssetSelectorButton,
  CompactMetricCard,
  PremiumSlider,
} from "./common";
import { AlertTriangle, Download, Shield, Wallet } from "lucide-react";
import { fmtUsd } from "@/src/lib";
import { LtvWarningBanner } from "@/src/components/ltv-warning-banner";
import { ActionButton } from "@/src/components/ui/action-button";
import { Title3 } from "@/src/components/ui/title-3";
import { Title4 } from "@/src/components/ui/title-4";

export function WithdrawTab({ protocol }: { protocol: ProtocolDetail }) {
  const [selectedAsset, setSelectedAsset] = useState(
    protocol.collateralAssets[0]?.symbol ?? "SOL",
  );
  const [withdrawAmount, setWithdrawAmount] = useState(0);

  // No collateral, nothing to withdraw.
  if (protocol.maxLTV == null || protocol.collateralAssets.length === 0) {
    return (
      <div className="rounded-lg border bg-white/2 border-border-base py-10 text-center text-[13px] text-text-muted">
        No collateral on this protocol to withdraw.
      </div>
    );
  }

  const maxLTV = protocol.maxLTV;

  const asset =
    protocol.collateralAssets.find((a) => a.symbol === selectedAsset) ??
    protocol.collateralAssets[0];
  const withdrawUsd = withdrawAmount * asset.price;
  const remainingCollateral = protocol.totalCollateralNum - withdrawUsd;
  const newLTV =
    remainingCollateral > 0
      ? (protocol.totalDebtNum / remainingCollateral) * 100
      : 0;
  const newHealth =
    newLTV > 0 ? Math.min(100, (maxLTV / newLTV) * 100) : 100;
  const isDangerous = newLTV > maxLTV * 0.85;
  const maxSafeWithdraw =
    protocol.totalDebtNum > 0
      ? Math.min(
          asset.balance,
          (protocol.totalCollateralNum -
            protocol.totalDebtNum / ((maxLTV * 0.85) / 100)) /
            asset.price,
        )
      : asset.balance;
  const safeMax = Math.max(0, maxSafeWithdraw);
  const remainingColUsd = remainingCollateral;
  const newLiqPrice =
    protocol.totalDebtNum > 0
      ? (protocol.totalDebtNum / (remainingColUsd / asset.price)) *
        (100 / maxLTV)
      : 0;
  const healthColor =
    newHealth > 70 ? C.accent : newHealth > 40 ? C.yellow : C.red;
  const hasValue = withdrawAmount > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-3">
        <Title3 text="Select Asset" />
        <div className="flex gap-2">
          {protocol.collateralAssets.map((a) => (
            <AssetSelectorButton
              key={a.symbol}
              symbol={a.symbol}
              meta={a.balanceStr}
              active={a.symbol === selectedAsset}
              onClick={() => {
                setSelectedAsset(a.symbol);
                setWithdrawAmount(0);
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <CompactMetricCard
          icon={Download}
          label="Withdraw Amount"
          value={`${withdrawAmount.toFixed(withdrawAmount < 1 ? 2 : 1)} ${asset.symbol}`}
          sub={`≈ ${fmtUsd(withdrawUsd)}`}
        />
        <CompactMetricCard
          icon={Wallet}
          label="Remaining Collateral"
          value={fmtUsd(Math.max(0, remainingCollateral))}
          sub={`Previously ${fmtUsd(protocol.totalCollateralNum)}`}
        />
        <CompactMetricCard
          icon={Shield}
          label="New Safety"
          value={`${Math.round(newHealth)}%`}
          sub={`Previously ${protocol.safetyScore}%`}
          valueColor={healthColor}
        />
      </div>

      <div className="rounded-lg border p-5 bg-white/2 border-border-base">
        <div className="flex items-center gap-1.5 mb-5">
          <TokenIcon symbol={asset.symbol} size={28} />
          <div>
            <span className="text-[16px] font-bold text-text-base">
              Withdraw {asset.symbol}
            </span>
            <span className="text-[12.5px] font-semibold ml-2 text-text-muted">
              Available: {asset.balanceStr}
            </span>
          </div>
        </div>

        <AmountInput
          value={withdrawAmount > 0 ? withdrawAmount.toString() : ""}
          onChange={(raw) => setWithdrawAmount(parseFloat(raw) || 0)}
          max={asset.balance}
          approxUsd={fmtUsd(withdrawUsd)}
          onMax={() => setWithdrawAmount(asset.balance)}
        />

        <div className="mb-5">
          <PremiumSlider
            value={withdrawAmount}
            max={asset.balance}
            onChange={(v) => setWithdrawAmount(v)}
          />
        </div>

        <div
          className="rounded-lg bg-surface-2 px-4 py-3.5 mb-5"
          style={{
            // background: isDangerous ? "rgba(229,83,75,0.04)" : C.bg,
            // borderColor: isDangerous ? "rgba(229,83,75,0.22)" : C.border,
            transition: "all 200ms ease",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <Title4 text="New LTV" />
            <span
              className="text-[14px] font-(family-name:--font-ibm-plex-mono) font-bold"
              style={{
                color:
                  newLTV < maxLTV * 0.5
                    ? C.accent
                    : newLTV < maxLTV * 0.8
                      ? C.yellow
                      : C.red,
              }}
            >
              {newLTV.toFixed(1)}%
            </span>
          </div>
          {protocol.totalDebtNum > 0 && (
            <div className="flex items-center justify-between mb-2">
              <Title4 text="Liquidation Price" />

              <span className="text-[14px] font-(family-name:--font-ibm-plex-mono) font-bold text-text-base">
                {hasValue ? fmtUsd(newLiqPrice) : "—"}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <Title4 text="Remaining Borrow Buffer" />

            <span className="text-[14px] font-(family-name:--font-ibm-plex-mono) font-bold text-text-dim">
              {fmtUsd(
                Math.max(
                  0,
                  (remainingCollateral * maxLTV) / 100 -
                    protocol.totalDebtNum,
                ),
              )}
            </span>
          </div>
          {isDangerous && newLTV <= maxLTV && (
            <div
              className="flex items-center gap-2 mt-3 pt-3"
              style={{ borderTop: `1px solid rgba(229,83,75,0.15)` }}
            >
              <AlertTriangle
                size={12}
                strokeWidth={2}
                className="text-danger"
              />
              <span className="text-[11px] font-medium text-danger">
                This withdrawal may place your position at risk.
              </span>
            </div>
          )}
        </div>

        {hasValue && newLTV > maxLTV && (
          <div className="mb-5">
            <LtvWarningBanner
              requiredLtv={`${newLTV.toFixed(1)}%`}
              maxLtv={maxLTV}
              protocolName={protocol.name}
              collateral={asset.symbol}
              debt={protocol.debtAssets[0]?.symbol ?? "—"}
              title={`Withdrawing ${asset.symbol} would exceed ${protocol.name}'s supported LTV`}
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <Title4
            text={`Maximum safe withdrawal: ${safeMax.toFixed(1)} ${asset.symbol}`}
          />
          <ActionButton disabled={!hasValue || newLTV > maxLTV}>
            Withdraw {asset.symbol}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
