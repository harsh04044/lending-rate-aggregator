import type { ProtocolDetail } from "@/app/(dashboard)/protocols/[slug]/page";

/*
 * Signed-delta inputs to simulateAction.
 *
 *   collateralDeltaUsd: +supply, -withdraw
 *   debtDeltaUsd:       +borrow, -repay
 *
 * The modal feeds raw deposit/withdraw/borrow/repay USD figures and nets them
 * into these two signed values before calling. Same primitive serves the
 * Simulator tab.
 *
 * `scope` is an optional override for the base position the simulation runs
 * against. Pool protocols (Drift/Save/Kamino) share one collateral pool and
 * one debt pool, so scope can be omitted and the simulator falls back to
 * protocol-level totals. JupLend is per-obligation: each pair has its own
 * LTV/maxLTV/liqThreshold, so the modal must pass per-pair numbers as scope.
 */
export interface SimulateActionParams {
  collateralDeltaUsd: number;
  debtDeltaUsd: number;
  scope?: SimulateScope;
}

export interface SimulateScope {
  currentCollateralUsd: number;
  currentDebtUsd: number;
  currentLTV: number;
  maxLTV: number | null;
  liqThreshold: number | null;
}

export interface SimulationResult {
  // Raw USD positions
  currentCollateralUsd: number;
  newCollateralUsd: number;
  currentDebtUsd: number;
  newDebtUsd: number;

  // LTV (percent)
  currentLTV: number;
  newLTV: number;
  ltvDelta: number;

  // Health (percent, 0–100)
  currentHealth: number;
  newHealth: number;
  healthDelta: number;

  // Liquidation headroom (LTV pct points away from liqThreshold).
  // null when liqThreshold is unknown.
  liqDistanceCurrent: number | null;
  liqDistanceNew: number | null;

  // Validation flags
  ltvExceeded: boolean; // newLTV strictly above protocol.maxLTV
  collateralWentNegative: boolean;
  debtWentNegative: boolean;
}

function clampHealth(pct: number): number {
  if (!Number.isFinite(pct)) return 100;
  return Math.max(0, Math.min(100, pct));
}

/*
 * Apply signed collateral & debt deltas to a protocol's current state and
 * return current/simulated numbers in one shape so the UI can render a
 * "current vs simulated" comparison without repeating math.
 *
 * Math model — same shape used by the protocol's on-chain liquidation:
 *   ltv     = totalDebtUsd / totalCollateralUsd × 100
 *   health  = (liqThreshold - ltv) / liqThreshold × 100   (0 = at liquidation)
 *
 * `liqThreshold` and `maxLTV` are the USD-weighted protocol-level numbers
 * already on `ProtocolDetail`. When they're null (no collateral on this
 * protocol), simulation still runs but health/liq-distance read as null.
 */
export function simulateAction(
  protocol: ProtocolDetail,
  params: SimulateActionParams,
): SimulationResult {
  const { collateralDeltaUsd, debtDeltaUsd, scope } = params;

  const currentCollateralUsd =
    scope?.currentCollateralUsd ?? protocol.totalCollateralNum;
  const currentDebtUsd = scope?.currentDebtUsd ?? protocol.totalDebtNum;

  const newCollateralUsd = currentCollateralUsd + collateralDeltaUsd;
  const newDebtUsd = currentDebtUsd + debtDeltaUsd;

  const collateralWentNegative = newCollateralUsd < 0;
  const debtWentNegative = newDebtUsd < 0;

  const currentLTV = scope?.currentLTV ?? protocol.currentLTV;
  const newLTV =
    newCollateralUsd > 0
      ? Math.max(0, (newDebtUsd / newCollateralUsd) * 100)
      : newDebtUsd > 0
        ? Infinity
        : 0;

  const liqThreshold =
    scope !== undefined ? scope.liqThreshold : protocol.liqThreshold;
  const maxLTV = scope !== undefined ? scope.maxLTV : protocol.maxLTV;

  const currentHealth =
    liqThreshold != null && liqThreshold > 0
      ? clampHealth(((liqThreshold - currentLTV) / liqThreshold) * 100)
      : protocol.safetyScore;
  const newHealth =
    liqThreshold != null && liqThreshold > 0
      ? Number.isFinite(newLTV)
        ? clampHealth(((liqThreshold - newLTV) / liqThreshold) * 100)
        : 0
      : currentHealth;

  const liqDistanceCurrent =
    liqThreshold != null ? Math.max(0, liqThreshold - currentLTV) : null;
  const liqDistanceNew =
    liqThreshold != null
      ? Number.isFinite(newLTV)
        ? Math.max(0, liqThreshold - newLTV)
        : 0
      : null;

  // When newLTV is Infinity (collateral fully drained while debt remains),
  // that's the worst possible LTV — explicitly counts as "exceeded".
  // Without this, a withdraw-all-while-in-debt action slips through because
  // Infinity isn't `> maxLTV` under an isFinite guard.
  const ltvExceeded =
    maxLTV != null && newLTV > maxLTV;

  // For display: NaN renders as "—" via fmtPct. Showing "0.0%" for the
  // collateral-drained case was misleading (looked like LTV improved).
  const displayNewLTV = Number.isFinite(newLTV) ? newLTV : NaN;

  return {
    currentCollateralUsd,
    newCollateralUsd,
    currentDebtUsd,
    newDebtUsd,
    currentLTV,
    newLTV: displayNewLTV,
    ltvDelta: Number.isFinite(displayNewLTV)
      ? displayNewLTV - currentLTV
      : Infinity,
    currentHealth,
    newHealth,
    healthDelta: newHealth - currentHealth,
    liqDistanceCurrent,
    liqDistanceNew,
    ltvExceeded,
    collateralWentNegative,
    debtWentNegative,
  };
}
