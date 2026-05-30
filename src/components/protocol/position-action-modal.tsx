"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, X } from "lucide-react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { ProtocolDetail } from "@/app/(dashboard)/protocols/[slug]/page";
import { ActionButton } from "@/src/components/ui/action-button";
import { SegmentedTabs } from "@/src/components/ui/segmented-tabs";
import { MainCard } from "@/src/components/main-card";
import { simulateAction, type SimulateScope } from "@/src/lib/simulate";
import { submitJuplendPairAction } from "@/src/lib/tx/juplend-actions";
import { toast } from "@/src/lib/toast";
import {
  submitKaminoCollateralAction,
  submitKaminoDebtAction,
} from "@/src/lib/tx/kamino-actions";
import {
  submitSaveCollateralAction,
  submitSaveDebtAction,
} from "@/src/lib/tx/save-actions";
import {
  GENERIC_TX_FAILURE_MESSAGE,
  toSubmitError,
  type SubmitError,
} from "@/src/lib/tx/action-errors";
import { useWalletTokenBalance } from "@/src/components/wallet/useWalletTokenBalance";

// Split files — one concern per module.
import type { ActionTarget, PairTab } from "./position-action/types";
import {
  parseAmt,
  formatBalanceForInput,
  formatBalanceForHint,
} from "./position-action/format";
import {
  CollateralHeader,
  DebtHeader,
  PairHeader,
} from "./position-action/headers";
import { PairedAmountInputs } from "./position-action/amount-field";
import { ComparisonTable } from "./position-action/comparison-table";
import {
  SubmitErrorBanner,
  ValidationBanner,
} from "./position-action/error-banner";
import {
  deriveActionLabel,
  deriveCollateralPrice,
  priceFromPairCollateral,
  priceFromPairDebt,
  priceOfDebtAsset,
  scopeFromAsset,
  scopeFromPair,
} from "./position-action/derivations";

// Re-export so existing call sites (overview.tsx) keep working.
export type { ActionTarget };

export function PositionActionModal({
  protocol,
  target,
  onClose,
  onConfirmed,
}: {
  protocol: ProtocolDetail;
  target: ActionTarget;
  onClose: () => void;
  /** Fired once the tx reaches "confirmed" commitment. The host page wires
   *  this to its `useProtocol().refetch({ noCache: true })` so the view
   *  silently refreshes with fresh on-chain state. */
  onConfirmed?: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Input state ────────────────────────────────────────────────────────
  const [supply, setSupply] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [borrow, setBorrow] = useState("");
  const [repay, setRepay] = useState("");

  // Tracks whether the user clicked MAX (vs typed the value). Lets the
  // submit handler swap in the protocol's "operate on entire balance"
  // sentinel so partial repay/withdraw doesn't leave dust under the
  // protocol's MIN_BORROW floor.
  const [withdrawIsMax, setWithdrawIsMax] = useState(false);
  const [repayIsMax, setRepayIsMax] = useState(false);

  const handleWithdrawChange = (v: string) => {
    setWithdraw(v);
    setWithdrawIsMax(false);
  };
  const handleRepayChange = (v: string) => {
    setRepay(v);
    setRepayIsMax(false);
  };

  const [pairTab, setPairTab] = useState<PairTab>("supply-borrow");

  const inputs = {
    supply: parseAmt(supply),
    withdraw: parseAmt(withdraw),
    borrow: parseAmt(borrow),
    repay: parseAmt(repay),
  };

  const supplyAsset =
    target.kind === "collateral"
      ? { mint: target.asset.mint, decimals: target.asset.decimals }
      : target.kind === "pair"
        ? {
            mint: target.pair.collateralMint,
            decimals: target.pair.collateralDecimals,
          }
        : null;
  const { balance: supplyWalletBalance } = useWalletTokenBalance(
    supplyAsset?.mint ?? null,
    supplyAsset?.decimals ?? null,
  );

  // ── Per-target rendering branches ──────────────────────────────────────
  const { collateralDeltaUsd, debtDeltaUsd, headerNode, tabsNode, fields } =
    useMemo(() => {
      switch (target.kind) {
        case "collateral": {
          const price = deriveCollateralPrice(target.asset);
          const colDelta = (inputs.supply - inputs.withdraw) * price;
          return {
            collateralDeltaUsd: colDelta,
            debtDeltaUsd: 0,
            headerNode: <CollateralHeader asset={target.asset} />,
            tabsNode: null,
            fields: (
              <PairedAmountInputs
                left={{
                  label: `Supply (${target.asset.symbol})`,
                  value: supply,
                  onChange: setSupply,
                  symbol: target.asset.symbol,
                  logoUrl: target.asset.logoUrl,
                  hint:
                    supplyWalletBalance != null
                      ? `Wallet balance ${formatBalanceForHint(supplyWalletBalance)}`
                      : `Wallet balance —`,
                  onMax:
                    supplyWalletBalance != null && supplyWalletBalance > 0
                      ? () =>
                          setSupply(
                            formatBalanceForInput(
                              supplyWalletBalance,
                              target.asset.decimals,
                            ),
                          )
                      : undefined,
                }}
                right={{
                  label: `Withdraw (${target.asset.symbol})`,
                  value: withdraw,
                  onChange: handleWithdrawChange,
                  symbol: target.asset.symbol,
                  logoUrl: target.asset.logoUrl,
                  hint: `Supplied ${target.asset.balanceStr}`,
                  onMax: () => {
                    setWithdraw(String(target.asset.balance));
                    setWithdrawIsMax(true);
                  },
                }}
              />
            ),
          };
        }
        case "debt": {
          const price = priceOfDebtAsset(target.asset);
          const debtDelta = (inputs.borrow - inputs.repay) * price;
          return {
            collateralDeltaUsd: 0,
            debtDeltaUsd: debtDelta,
            headerNode: <DebtHeader asset={target.asset} />,
            tabsNode: null,
            fields: (
              <PairedAmountInputs
                left={{
                  label: `Repay (${target.asset.symbol})`,
                  value: repay,
                  onChange: handleRepayChange,
                  symbol: target.asset.symbol,
                  logoUrl: target.asset.logoUrl,
                  hint: `Borrowed ${target.asset.borrowedStr}`,
                  onMax: () => {
                    setRepay(String(target.asset.borrowed));
                    setRepayIsMax(true);
                  },
                }}
                right={{
                  label: `Borrow (${target.asset.symbol})`,
                  value: borrow,
                  onChange: setBorrow,
                  symbol: target.asset.symbol,
                  logoUrl: target.asset.logoUrl,
                  hint: `Wallet balance —`, // TODO INTEGRATION: wallet balance API
                }}
              />
            ),
          };
        }
        case "pair": {
          const pair = target.pair;
          const colPrice = priceFromPairCollateral(pair);
          const debtPrice = priceFromPairDebt(pair);
          const isCollateralOnly = pair.debtAmount === 0;

          const colDelta = isCollateralOnly
            ? (inputs.supply - inputs.withdraw) * colPrice
            : pairTab === "supply-borrow"
              ? inputs.supply * colPrice
              : -inputs.withdraw * colPrice;
          const debtDelta = isCollateralOnly
            ? 0
            : pairTab === "supply-borrow"
              ? inputs.borrow * debtPrice
              : -inputs.repay * debtPrice;

          const tabs = isCollateralOnly ? null : (
            <SegmentedTabs<PairTab>
              tabs={[
                { value: "supply-borrow", label: "Supply / Borrow" },
                { value: "repay-withdraw", label: "Repay / Withdraw" },
              ]}
              value={pairTab}
              onChange={setPairTab}
            />
          );

          const node = isCollateralOnly ? (
            <PairedAmountInputs
              left={{
                label: `Supply (${pair.collateralSymbol})`,
                value: supply,
                onChange: setSupply,
                symbol: pair.collateralSymbol,
                logoUrl: pair.collateralLogoUrl,
                hint:
                  supplyWalletBalance != null
                    ? `Wallet balance ${formatBalanceForHint(supplyWalletBalance)}`
                    : `Wallet balance —`,
                onMax:
                  supplyWalletBalance != null && supplyWalletBalance > 0
                    ? () =>
                        setSupply(
                          formatBalanceForInput(
                            supplyWalletBalance,
                            pair.collateralDecimals,
                          ),
                        )
                    : undefined,
              }}
              right={{
                label: `Withdraw (${pair.collateralSymbol})`,
                value: withdraw,
                onChange: handleWithdrawChange,
                symbol: pair.collateralSymbol,
                logoUrl: pair.collateralLogoUrl,
                hint: `Supplied ${pair.collateralAmountStr}`,
                onMax: () => {
                  setWithdraw(String(pair.collateralAmount));
                  setWithdrawIsMax(true);
                },
              }}
            />
          ) : pairTab === "supply-borrow" ? (
              <PairedAmountInputs
                left={{
                  label: `Supply (${pair.collateralSymbol})`,
                  value: supply,
                  onChange: setSupply,
                  symbol: pair.collateralSymbol,
                  logoUrl: pair.collateralLogoUrl,
                  hint:
                    supplyWalletBalance != null
                      ? `Wallet balance ${formatBalanceForHint(supplyWalletBalance)}`
                      : `Wallet balance —`,
                  onMax:
                    supplyWalletBalance != null && supplyWalletBalance > 0
                      ? () =>
                          setSupply(
                            formatBalanceForInput(
                              supplyWalletBalance,
                              pair.collateralDecimals,
                            ),
                          )
                      : undefined,
                }}
                right={{
                  label: `Borrow (${pair.debtSymbol})`,
                  value: borrow,
                  onChange: setBorrow,
                  symbol: pair.debtSymbol,
                  logoUrl: pair.debtLogoUrl,
                  hint:
                    protocol.maxLTV != null
                      ? `LTV cap ${protocol.maxLTV.toFixed(0)}%`
                      : undefined,
                }}
              />
            ) : (
              <PairedAmountInputs
                left={{
                  label: `Repay (${pair.debtSymbol})`,
                  value: repay,
                  onChange: handleRepayChange,
                  symbol: pair.debtSymbol,
                  logoUrl: pair.debtLogoUrl,
                  hint: `Outstanding ${pair.debtAmountStr}`,
                  onMax: () => {
                    setRepay(String(pair.debtAmount));
                    setRepayIsMax(true);
                  },
                }}
                right={{
                  label: `Withdraw (${pair.collateralSymbol})`,
                  value: withdraw,
                  onChange: handleWithdrawChange,
                  symbol: pair.collateralSymbol,
                  logoUrl: pair.collateralLogoUrl,
                  hint: `Supplied ${pair.collateralAmountStr}`,
                  onMax: () => {
                    setWithdraw(String(pair.collateralAmount));
                    setWithdrawIsMax(true);
                  },
                }}
              />
            );

          return {
            collateralDeltaUsd: colDelta,
            debtDeltaUsd: debtDelta,
            headerNode: <PairHeader pair={pair} />,
            tabsNode: tabs,
            fields: node,
          };
        }
      }
    }, [
      target,
      pairTab,
      supply,
      withdraw,
      borrow,
      repay,
      inputs.supply,
      inputs.withdraw,
      inputs.borrow,
      inputs.repay,
      protocol.maxLTV,
      supplyWalletBalance,
    ]);

  // ── Simulation ─────────────────────────────────────────────────────────
  // Pair targets carry their own scope. Per-asset targets resolve the
  // source position via the asset's meta.marketAddress (set for protocols
  // that aggregate per-position, e.g. Kamino) so the simulator runs against
  // the correct obligation, not a cross-market aggregate.
  const scope: SimulateScope | undefined =
    target.kind === "pair"
      ? scopeFromPair(target.pair)
      : scopeFromAsset(target.asset, protocol);

  const sim = simulateAction(protocol, {
    collateralDeltaUsd,
    debtDeltaUsd,
    scope,
  });

  const maxLtv = scope ? scope.maxLTV : protocol.maxLTV;

  const actionLabel = deriveActionLabel(collateralDeltaUsd, debtDeltaUsd);
  const hasInput = actionLabel != null;

  // ── Submit ─────────────────────────────────────────────────────────────
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  const walletConnected = !!publicKey && !!signTransaction;

  // MAX is a sentinel "operate on the entire balance at execution time" —
  // the displayed amount is just visual, the protocol owns the math. Skip
  // the simulator-side over-repay / over-withdraw guards in that case so
  // the rounded-displayed vs precise-typed mismatch doesn't falsely
  // disable the button.
  // The MAX flag is set exclusively by withdraw / repay MAX clicks and gets
  // cleared the moment the user types into the field. So its truthiness is
  // a sufficient signal on its own — no tab/kind gating needed.
  const ignoreNegativeDebt = repayIsMax;
  const ignoreNegativeCollateral = withdrawIsMax;

  const submitDisabled =
    actionLabel == null ||
    (!ignoreNegativeCollateral && sim.collateralWentNegative) ||
    (!ignoreNegativeDebt && sim.debtWentNegative) ||
    sim.ltvExceeded ||
    submitting ||
    !walletConnected;

  async function handleSubmit() {
    if (!publicKey || !signTransaction) {
      setSubmitError({
        kind: "plain",
        message: "Connect a wallet to continue.",
      });
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    try {
      let sent: { signature: string; confirm: Promise<void> };

      // Per-protocol dispatch. Each handler is in its own *-actions module.
      if (target.kind === "pair" && protocol.slug === "juplend") {
        // Collateral-only positions have no borrow/repay UI, so the tab
        // state is meaningless — derive it from whichever side has input.
        const effectivePairTab =
          target.pair.debtAmount === 0
            ? parseAmt(withdraw) > 0
              ? "repay-withdraw"
              : "supply-borrow"
            : pairTab;
        sent = await submitJuplendPairAction({
          pair: target.pair,
          pairTab: effectivePairTab,
          inputs: { supply, withdraw, borrow, repay },
          flags: { withdrawIsMax, repayIsMax },
          publicKey,
          signTransaction,
          connection,
        });
      } else if (target.kind === "collateral" && protocol.slug === "kamino") {
        sent = await submitKaminoCollateralAction({
          asset: target.asset,
          inputs: { supply, withdraw },
          flags: { withdrawIsMax },
          publicKey,
          signTransaction,
          connection,
        });
      } else if (target.kind === "debt" && protocol.slug === "kamino") {
        sent = await submitKaminoDebtAction({
          asset: target.asset,
          inputs: { borrow, repay },
          flags: { repayIsMax },
          publicKey,
          signTransaction,
          connection,
        });
      } else if (target.kind === "collateral" && protocol.slug === "save") {
        sent = await submitSaveCollateralAction({
          asset: target.asset,
          inputs: { supply, withdraw },
          flags: { withdrawIsMax },
          publicKey,
          signTransaction,
          connection,
        });
      } else if (target.kind === "debt" && protocol.slug === "save") {
        sent = await submitSaveDebtAction({
          asset: target.asset,
          inputs: { borrow, repay },
          flags: { repayIsMax },
          publicKey,
          signTransaction,
          connection,
        });
      } else {
        throw new Error(
          `Position management isn't wired for ${protocol.name} yet.`,
        );
      }

      // Tx is submitted to the cluster. The on-chain confirm step takes
      // 5-15s — show that as a "Confirming…" toast that updates to
      // success/error in the background. Don't await it: close the modal
      // immediately and let the user keep working.
      //
      // On confirmation, fire onConfirmed → host page refetches with
      // `noCache: true`, which bypasses the server cache and writes the
      // fresh data back. One round-trip total (vs. invalidate+refetch).
      const label = actionLabel ?? "Action";
      toast.promise(
        sent.confirm.then(() => onConfirmed?.()),
        {
          loading: `${label} on ${protocol.name}…`,
          success: `${label} successful on ${protocol.name}.`,
          error: (err: unknown) => {
            console.error("[PositionActionModal] confirm failed:", err);
            return GENERIC_TX_FAILURE_MESSAGE;
          },
        },
      );

      onClose();
    } catch (err: unknown) {
      console.error("[PositionActionModal] tx failed:", err);
      const submitErr = toSubmitError(err);
      setSubmitError(submitErr);
      // For the structured banner cases we keep the rich in-modal banner
      // and skip the toast (would just duplicate the info). Plain errors
      // surface as a toast too so the user has a transient signal in
      // addition to the banner.
      if (submitErr.kind === "plain") {
        toast.error(submitErr.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md p-4 sm:p-6">
      <div className="absolute inset-0 bg-surface-0/72" onClick={onClose} />

      <MainCard className="p-5! sm:p-7.5! rounded-lg! overflow-y-auto! overflow-x-hidden max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-80px)] w-full sm:w-150 custom-scrollbar bg-white/2!">
        <div className="">
          <div className="flex items-start justify-between mb-8">
            {headerNode}
            <X
              size={25}
              strokeWidth={2}
              onClick={onClose}
              className="cursor-pointer text-text-muted"
            />
          </div>

          {tabsNode && <div className="mb-6">{tabsNode}</div>}

          <div className="mb-6">{fields}</div>

          {sim.ltvExceeded && (
            <ValidationBanner
              message={`New LTV exceeds the protocol's max LTV (${
                protocol.maxLTV?.toFixed(1) ?? "—"
              }%).`}
            />
          )}
          {!ignoreNegativeCollateral && sim.collateralWentNegative && (
            <ValidationBanner message="Cannot withdraw more than the supplied balance." />
          )}
          {!ignoreNegativeDebt && sim.debtWentNegative && (
            <ValidationBanner message="Cannot repay more than the outstanding debt." />
          )}
          {submitError && <SubmitErrorBanner error={submitError} />}

          <ComparisonTable sim={sim} hasInput={hasInput} maxLtv={maxLtv} />

          <div className="flex items-center justify-between mt-8">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md font-(family-name:--font-dm-sans) text-[12.5px] font-medium cursor-pointer text-text-muted bg-surface-2"
            >
              <ArrowLeft size={13} strokeWidth={1.8} />
              Cancel
            </button>

            <ActionButton disabled={submitDisabled} onClick={handleSubmit}>
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Submitting…
                </span>
              ) : !walletConnected ? (
                "Connect wallet"
              ) : (
                (actionLabel ?? "Enter an amount")
              )}
            </ActionButton>
          </div>
        </div>
      </MainCard>
    </div>
  );
}
