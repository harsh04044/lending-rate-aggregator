"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  DollarSign,
  Loader2,
  PlusSquare,
  Shield,
  X,
} from "lucide-react";
import BN from "bn.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Title3 } from "@/src/components/ui/title-3";
import { Title4 } from "@/src/components/ui/title-4";
import { MainCard } from "@/src/components/main-card";
import { ProtocolIcon, TokenIcon } from "@/src/components/icons/token-icons";
import { LtvWarningBanner } from "@/src/components/ltv-warning-banner";
import { ActionButton } from "@/src/components/ui/action-button";
import type { MarketOption } from "@/src/lib/api";
import { Protocol } from "@/app/types/main";
import { prepareDriftCreatePosition } from "@/src/lib/tx/drift";
import { prepareJupLendCreatePosition } from "@/src/lib/tx/juplend";
import { prepareKaminoCreatePosition } from "@/src/lib/tx/kamino";
import {
  prepareSaveCreatePosition,
  type SaveReserveDescriptor,
} from "@/src/lib/tx/save";
import { sendV0Tx } from "@/src/lib/tx/send";
import { invalidatePositionsCache } from "@/src/lib/api/invalidate";
import { toast } from "@/src/lib/toast";
import { GENERIC_TX_FAILURE_MESSAGE } from "@/src/lib/tx/action-errors";
import { useWalletTokenBalance } from "@/src/components/wallet/useWalletTokenBalance";
import {
  formatBalanceForInput,
  formatBalanceForHint,
} from "@/src/components/protocol/position-action/format";

export interface ModalToken {
  mint: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
}

// Multiplies a decimal string ("1.5") by 10^decimals, rounding down, returning
// a BN of raw token units. Avoids floating-point drift for large amounts.
function toRawAmount(input: string, decimals: number): BN {
  const trimmed = input.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return new BN(0);
  const [whole = "0", frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");
  if (!combined) return new BN(0);
  return new BN(combined);
}

function MetricsCard({
  icon: Icon,
  label,
  value,
  toneClass,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  toneClass?: string;
}) {
  return (
    <div className="flex-1 rounded-md bg-surface-2 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={13} strokeWidth={1.8} className="text-text-muted" />
        <Title4 text={label} />
      </div>
      <span
        className={`font-(family-name:--font-ibm-plex-mono) text-[22px] font-bold leading-none ${toneClass ?? "text-text-base"}`}
      >
        {value}
      </span>
    </div>
  );
}

export function CreatePositionModal({
  protocolName,
  market,
  collateralToken,
  collateralPrice,
  debtToken,
  debtPrice,
  onClose,
  onSuccess,
}: {
  protocolName: string;
  market: MarketOption;
  collateralToken: ModalToken;
  collateralPrice: number | null;
  debtToken: ModalToken | null;
  debtPrice: number | null;
  onClose: () => void;
  onSuccess?: (signature: string) => void;
}) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();

  const [collateralAmount, setCollateralAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { balance: collateralWalletBalance } = useWalletTokenBalance(
    collateralToken.mint,
    collateralToken.decimals,
  );

  const supplyApy = market.supplyApy ?? 0;
  const borrowApy = market.borrowApy ?? 0;
  const maxLTV = market.ltv ?? 0;

  // Live prices from Jupiter (`useTokenPrices`); fall back to 0 while loading.
  const collateralUsd =
    parseFloat(collateralAmount || "0") * (collateralPrice ?? 0);
  const borrowUsd = debtToken
    ? parseFloat(borrowAmount || "0") * (debtPrice ?? 0)
    : 0;

  const currentLtv =
    collateralUsd > 0 ? Math.min((borrowUsd / collateralUsd) * 100, 100) : 0;

  const healthPct =
    currentLtv > 0 && maxLTV > 0
      ? Math.min(100, ((maxLTV - currentLtv) / maxLTV) * 100)
      : 100;

  const supplyDaily = (collateralUsd * supplyApy) / 100 / 365;
  const borrowDaily = (borrowUsd * borrowApy) / 100 / 365;
  const netDaily = supplyDaily - borrowDaily;
  const netAPY =
    supplyApy -
    (borrowUsd > 0 ? borrowApy * (borrowUsd / Math.max(collateralUsd, 1)) : 0);

  const hasCollateral = parseFloat(collateralAmount || "0") > 0;
  const ltvExceeded =
    hasCollateral && debtToken !== null && maxLTV > 0 && currentLtv > maxLTV;
  const canCreate = hasCollateral && !ltvExceeded;

  const collateralInputRef = useRef<HTMLInputElement>(null);
  const borrowInputRef = useRef<HTMLInputElement>(null);

  // Slider position is purely derived from currentLtv — no separate state,
  // no useEffect feedback loop. Dragging the slider updates borrowAmount,
  // which re-derives currentLtv on the next render, which moves the slider.
  // Single source of truth = the typed input.
  const ltvSlider = Math.min(Math.round(currentLtv), Math.round(maxLTV));
  const sliderEnabled =
    debtToken !== null &&
    collateralUsd > 0 &&
    debtPrice !== null &&
    debtPrice > 0;

  const handleSliderChange = (val: number) => {
    if (!sliderEnabled || !debtPrice) return;
    const newBorrowUsd = (collateralUsd * val) / 100;
    const newBorrowAmt = newBorrowUsd / debtPrice;
    // Round to a sensible precision so "50% slider" doesn't write "0.00012345"
    setBorrowAmount(newBorrowAmt > 0 ? newBorrowAmt.toFixed(4) : "");
  };

  const ltvRatio = maxLTV > 0 ? currentLtv / maxLTV : 0;
  const ltvToneClass =
    ltvRatio < 0.5
      ? "text-accent"
      : ltvRatio < 0.8
        ? "text-warn"
        : "text-danger";
  const ltvBgClass =
    ltvRatio < 0.5
      ? "bg-accent/14"
      : ltvRatio < 0.8
        ? "bg-warn/14"
        : "bg-danger/14";
  const ltvBorderClass =
    ltvRatio < 0.5
      ? "border-accent"
      : ltvRatio < 0.8
        ? "border-warn"
        : "border-danger";
  const ltvLabel =
    ltvRatio < 0.5 ? "Safe" : ltvRatio < 0.8 ? "Moderate" : "Aggressive";
  const trackGradient =
    "linear-gradient(90deg, var(--color-accent) 0%, var(--color-warn) 55%, var(--color-danger) 100%)";

  const healthToneClass =
    healthPct > 70
      ? "text-accent"
      : healthPct > 40
        ? "text-warn"
        : "text-danger";
  const netDailyToneClass = netDaily >= 0 ? "text-accent" : "text-danger";

  const title = debtToken
    ? `${collateralToken.symbol} / ${debtToken.symbol} on ${protocolName}`
    : `${collateralToken.symbol} on ${protocolName}`;

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  async function handleCreate() {
    if (!publicKey || !signTransaction) {
      setSubmitError("Connect a wallet first.");
      return;
    }
    if (!hasCollateral) return;

    setSubmitError(null);
    setSubmitting(true);
    try {
      const colRaw = toRawAmount(collateralAmount, collateralToken.decimals);
      const debtRaw =
        debtToken && parseFloat(borrowAmount || "0") > 0
          ? toRawAmount(borrowAmount, debtToken.decimals)
          : new BN(0);

      let prepared;
      if (market.protocol === Protocol.JupLend) {
        const meta = market.meta as { vaultId?: number } | undefined;
        if (typeof meta?.vaultId !== "number") {
          throw new Error("JupLend vault is missing for this pair.");
        }
        prepared = await prepareJupLendCreatePosition({
          vaultId: meta.vaultId,
          collateralMint: collateralToken.mint,
          debtMint: debtToken?.mint ?? collateralToken.mint,
          collateralAmountRaw: colRaw,
          debtAmountRaw: debtRaw,
          walletPublicKey: publicKey,
          connection,
        });
      } else if (market.protocol === Protocol.Kamino) {
        prepared = await prepareKaminoCreatePosition({
          collateralMint: collateralToken.mint,
          debtMint: debtToken?.mint ?? collateralToken.mint,
          collateralAmountRaw: colRaw,
          debtAmountRaw: debtRaw,
          walletPublicKey: publicKey,
          connection,
        });
      } else if (market.protocol === Protocol.Save) {
        const meta = market.meta as
          | {
              poolAddress?: string;
              authorityAddress?: string;
              lookupTableAddress?: string;
              collateralReserve?: SaveReserveDescriptor;
              debtReserve?: SaveReserveDescriptor | null;
              allReserves?: SaveReserveDescriptor[];
            }
          | undefined;
        if (
          !meta?.poolAddress ||
          !meta?.authorityAddress ||
          !meta?.collateralReserve ||
          !meta?.allReserves
        ) {
          throw new Error(
            "Save pool/collateral reserve is missing for this pair.",
          );
        }
        const willBorrow = !!debtToken && debtRaw.gt(new BN(0));
        if (willBorrow && !meta.debtReserve) {
          throw new Error("Save debt reserve is missing for this pair.");
        }
        prepared = await prepareSaveCreatePosition({
          collateralMint: collateralToken.mint,
          debtMint: willBorrow ? debtToken!.mint : undefined,
          poolAddress: meta.poolAddress,
          authorityAddress: meta.authorityAddress,
          lookupTableAddress: meta.lookupTableAddress,
          collateralReserve: meta.collateralReserve,
          debtReserve: willBorrow ? meta.debtReserve! : undefined,
          allReserves: meta.allReserves,
          collateralAmountRaw: colRaw,
          debtAmountRaw: debtRaw,
          walletPublicKey: publicKey,
          connection,
        });
      } else if (market.protocol === Protocol.Drift) {
        const meta = market.meta as
          | {
              collateralMarketIndex?: number;
              debtMarketIndex?: number;
              poolId?: number;
            }
          | undefined;
        if (
          typeof meta?.collateralMarketIndex !== "number" ||
          typeof meta?.debtMarketIndex !== "number"
        ) {
          throw new Error("Drift market indices are missing for this pair.");
        }
        prepared = await prepareDriftCreatePosition({
          collateralMint: collateralToken.mint,
          debtMint: debtToken?.mint ?? collateralToken.mint,
          collateralMarketIndex: meta.collateralMarketIndex,
          debtMarketIndex: meta.debtMarketIndex,
          poolId: meta.poolId,
          collateralAmountRaw: colRaw,
          debtAmountRaw: debtRaw,
          walletPublicKey: publicKey,
          connection,
        });
      } else {
        throw new Error(
          `Tx submission for ${protocolName} is not implemented yet.`,
        );
      }

      const sent = await sendV0Tx({
        connection,
        signer: { publicKey, signTransaction },
        instructions: prepared.instructions,
        lookupTables: prepared.lookupTables,
      });

      // Tx submitted. Confirmation runs in the background as a sonner
      // promise toast, modal closes now, user keeps moving.
      const walletAddr = publicKey.toBase58();
      const txProtocol = market.protocol;
      toast.promise(
        sent.confirm.then(() => {
          void invalidatePositionsCache(walletAddr, [txProtocol]);
        }),
        {
          loading: `Creating position on ${protocolName}…`,
          success: `Position created on ${protocolName}.`,
          error: (err: unknown) => {
            console.error("[CreatePosition] confirm failed:", err);
            return GENERIC_TX_FAILURE_MESSAGE;
          },
        },
      );

      onSuccess?.(sent.signature);
      onClose();
    } catch (err: unknown) {
      console.error("[CreatePosition] tx failed:", err);
      setSubmitError(GENERIC_TX_FAILURE_MESSAGE);
      toast.error(GENERIC_TX_FAILURE_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md p-4 sm:p-6">
      <div className="absolute inset-0 bg-surface-0/72" onClick={onClose} />

      <MainCard className="p-5! sm:p-7.5! rounded-lg! overflow-y-auto! overflow-x-hidden max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-80px)] w-full sm:w-150 custom-scrollbar bg-white/2!">
        <div className="">
          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div className="flex items-center gap-4">
              <ProtocolIcon name={protocolName} size={40} />
              <Title3 text={title} />
            </div>
            <X
              size={25}
              strokeWidth={2}
              onClick={onClose}
              className="cursor-pointer text-text-muted"
            />
          </div>

          {/* Inputs */}
          <div
            className={`grid gap-5 mb-6 ${debtToken ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {/* Collateral */}
            <div>
              <div className="mb-2">
                <Title4 text={`Collateral (${collateralToken.symbol})`} />
              </div>
              <div className="relative flex items-center gap-3 rounded-md bg-surface-2 p-3">
                <TokenIcon
                  symbol={collateralToken.symbol}
                  logoUrl={collateralToken.logoUrl}
                  size={28}
                />
                <input
                  ref={collateralInputRef}
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={collateralAmount}
                  onChange={(e) => setCollateralAmount(e.target.value)}
                  autoFocus
                  className="flex-1 min-w-0 bg-transparent font-(family-name:--font-ibm-plex-mono) text-[18px] font-medium outline-none placeholder:opacity-30 text-text-base"
                />
                {collateralWalletBalance != null &&
                  collateralWalletBalance > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setCollateralAmount(
                          formatBalanceForInput(
                            collateralWalletBalance,
                            collateralToken.decimals,
                          ),
                        )
                      }
                      className="p-2 cursor-pointer bg-surface-2 rounded-sm font-(family-name:--font-dm-sans) text-[12px] font-bold shrink-0 text-text-muted"
                    >
                      MAX
                    </button>
                  )}
              </div>
              <p className="font-(family-name:--font-ibm-plex-mono) text-[12px] mt-1.5 px-1 font-semibold text-text-muted">
                {hasCollateral
                  ? `≈ $${collateralUsd.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : collateralWalletBalance != null
                    ? `Wallet balance ${formatBalanceForHint(
                        collateralWalletBalance,
                      )} ${collateralToken.symbol}`
                    : " "}
              </p>
            </div>

            {/* Borrow */}
            {debtToken && (
              <div>
                <div className="mb-2">
                  <Title4 text={`Borrow (${debtToken.symbol})`} />
                </div>
                <div className="relative flex items-center gap-3 rounded-md bg-surface-2 p-3">
                  <TokenIcon
                    symbol={debtToken.symbol}
                    logoUrl={debtToken.logoUrl}
                    size={28}
                  />
                  <input
                    ref={borrowInputRef}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={borrowAmount}
                    onChange={(e) => setBorrowAmount(e.target.value)}
                    className="flex-1 bg-transparent font-(family-name:--font-ibm-plex-mono) text-[18px] font-medium outline-none placeholder:opacity-30 text-text-base"
                  />
                </div>
                {parseFloat(borrowAmount || "0") > 0 && (
                  <p className="font-(family-name:--font-ibm-plex-mono) text-[12px] mt-1.5 px-1 font-semibold text-text-muted">
                    ≈ $
                    {borrowUsd.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* LTV Warning */}
          {ltvExceeded && debtToken && (
            <div className="mb-6">
              <LtvWarningBanner
                requiredLtv={`${currentLtv.toFixed(1)}%`}
                maxLtv={maxLTV}
                protocolName={protocolName}
                collateral={collateralToken.symbol}
                debt={debtToken.symbol}
                onReduceBorrow={() => borrowInputRef.current?.focus()}
                onAddCollateral={() => collateralInputRef.current?.focus()}
              />
            </div>
          )}

          {/* Live metrics — Health/LTV only make sense with a borrow leg.
              Collateral-only positions show Supply APY + Daily P&L instead. */}
          <div className="flex gap-3 mb-6">
            {debtToken ? (
              <>
                <MetricsCard
                  icon={Shield}
                  label="Health"
                  value={`${Math.round(healthPct)}%`}
                  toneClass={healthToneClass}
                />
                <MetricsCard
                  icon={Activity}
                  label="LTV"
                  value={`${currentLtv.toFixed(1)}%`}
                  toneClass={ltvToneClass}
                />
              </>
            ) : (
              <MetricsCard
                icon={Activity}
                label="Supply APY"
                value={`${supplyApy.toFixed(2)}%`}
                toneClass="text-accent"
              />
            )}
            <MetricsCard
              icon={DollarSign}
              label="Daily P&L"
              value={`${netDaily >= 0 ? "+" : ""}$${Math.abs(netDaily).toFixed(2)}`}
              toneClass={netDailyToneClass}
            />
          </div>

          {/* LTV Slider — only relevant when there's a borrow leg. Disabled
              until the user enters a collateral amount + a debt price loads. */}
          {debtToken && maxLTV > 0 && (
            <div className={`mb-7 ${sliderEnabled ? "" : "opacity-60"}`}>
              <div className="flex items-center justify-between mb-3">
                <Title4 text="LTV Slider" />
                <div className="flex items-center gap-2">
                  <span
                    className={`font-(family-name:--font-ibm-plex-mono) text-[12px] font-semibold ${ltvToneClass}`}
                  >
                    {ltvSlider}% / {maxLTV.toFixed(0)}%
                  </span>
                  <span
                    className={`font-(family-name:--font-dm-sans) text-[10px] font-semibold px-1.5 py-0.5 rounded ${ltvToneClass} ${ltvBgClass}`}
                  >
                    {ltvLabel}
                  </span>
                </div>
              </div>
              <div className="relative px-0.5">
                <div className="relative h-2 rounded-full overflow-hidden bg-border-base">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-75 ease-linear"
                    style={{
                      width: `${(ltvSlider / maxLTV) * 100}%`,
                      background: trackGradient,
                    }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.round(maxLTV)}
                  step={1}
                  value={ltvSlider}
                  disabled={!sliderEnabled}
                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                  className="absolute inset-0 w-full h-8 -mt-3 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                />
                <div
                  className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 pointer-events-none bg-surface-3 transition-[left] duration-75 ease-linear ${ltvBorderClass}`}
                  style={{
                    left: `calc(${(ltvSlider / maxLTV) * 100}% - 8px)`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Summary card */}
          <div className="rounded-md bg-surface-2 px-5 py-4 mb-6">
            <div className="flex items-center justify-between mb-2.5">
              <Title4 text={`Supply APY (${supplyApy.toFixed(2)}%)`} />
              <span className="font-(family-name:--font-ibm-plex-mono) text-[12px] font-semibold text-accent">
                +${supplyDaily.toFixed(2)}/day
              </span>
            </div>
            {debtToken && (
              <div className="flex items-center justify-between mb-2.5">
                <Title4 text={`Borrow APR (${borrowApy.toFixed(2)}%)`} />
                <span className="font-(family-name:--font-ibm-plex-mono) text-[12px] font-semibold text-danger">
                  -${borrowDaily.toFixed(2)}/day
                </span>
              </div>
            )}
            <div className="h-px my-2.5 bg-border-base" />
            <div className="flex items-center justify-between">
              <span className="font-(family-name:--font-dm-sans) text-[12px] font-semibold text-text-base">
                Net
              </span>
              <div className="flex items-center gap-4">
                <span
                  className={`font-(family-name:--font-ibm-plex-mono) text-[13px] font-semibold ${netAPY >= 0 ? "text-accent" : "text-danger"}`}
                >
                  {netAPY >= 0 ? "+" : ""}
                  {netAPY.toFixed(1)}%
                </span>
                <span
                  className={`font-(family-name:--font-ibm-plex-mono) text-[13px] font-semibold ${netDailyToneClass}`}
                >
                  {netDaily >= 0 ? "+" : "-"}${Math.abs(netDaily).toFixed(2)}
                  /day
                </span>
              </div>
            </div>
          </div>

          {/* Submission error */}
          {submitError && (
            <div className="mb-4 rounded-md bg-danger/10 border border-danger/25 px-4 py-2.5 font-(family-name:--font-dm-sans) text-[12px] font-semibold text-danger">
              {submitError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mt-8">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md font-(family-name:--font-dm-sans) text-[12.5px] font-medium cursor-pointer text-text-muted bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowLeft size={13} strokeWidth={1.8} />
              Back
            </button>

            <ActionButton
              disabled={!canCreate || submitting}
              onClick={handleCreate}
              leadingIcon={
                submitting ? (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                ) : (
                  <PlusSquare size={14} strokeWidth={2} />
                )
              }
            >
              {submitting
                ? "Confirming…"
                : `Create Position on ${protocolName}`}
            </ActionButton>
          </div>
        </div>
      </MainCard>
    </div>
  );
}
