import type {
  CollateralAsset,
  DebtAsset,
  JuplendPairPosition,
  ProtocolDetail,
} from "@/app/(dashboard)/protocols/[slug]/page";
import type { SimulateScope } from "@/src/lib/simulate";

// Per-token unit price helpers. Each shape carries the data slightly
// differently (price field vs derived from value/balance), so we have one
// derivation per asset kind.

export function priceOfDebtAsset(d: DebtAsset): number {
  if (!Number.isFinite(d.borrowed) || d.borrowed <= 0) return 0;
  return d.valueNum / d.borrowed;
}

export function deriveCollateralPrice(asset: CollateralAsset): number {
  if (asset.price > 0) return asset.price;
  if (asset.balance > 0) return asset.valueNum / asset.balance;
  return 0;
}

export function priceFromPairCollateral(pair: JuplendPairPosition): number {
  return parsePriceFromValueAmount(
    pair.collateralValueUsd,
    pair.collateralAmountStr,
  );
}

export function priceFromPairDebt(pair: JuplendPairPosition): number {
  return parsePriceFromValueAmount(pair.debtValueUsd, pair.debtAmountStr);
}

// Pair USD totals are stringy in ProtocolDetail (e.g. "$1.30") and amounts
// are stringy + suffixed (e.g. "1.30 USDC"). This strips non-numeric chars
// from both and divides to recover an implied unit price.
function parsePriceFromValueAmount(
  valueStr: string,
  amountStr: string,
): number {
  const value = parseFloat(valueStr.replace(/[^0-9.\-]/g, "")) || 0;
  const amount = parseFloat(amountStr.replace(/[^0-9.\-]/g, "")) || 0;
  if (amount <= 0) return 0;
  return value / amount;
}

// SimulateScope for a per-asset target.
//
// TODO: For protocols that aggregate per-position (Kamino today), the
// asset's meta carries `marketAddress` and we should look up the source
// position to use per-obligation totals + risk params, not protocol-wide
// aggregates. Today this returns undefined → simulator falls back to
// `protocol.totalCollateralNum` / `totalDebtNum`, which is correct only
// when the user has a single position per protocol. Multi-position users
// (e.g. Kamino Main + JLP) get slightly-off LTV/health predictions until
// `ProtocolDetail` exposes a NormalizedPosition[] (or a slimmed analog
// carrying totalCollateralUsd / totalDebtUsd / risk per position).
export function scopeFromAsset(
  _asset: CollateralAsset | DebtAsset,
  _protocol: ProtocolDetail,
): SimulateScope | undefined {
  return undefined;
}

// SimulateScope for a single JupLend pair. Lets the simulator use per-pair
// risk params (maxLTV / liqThreshold) instead of the protocol-wide aggregate.
export function scopeFromPair(pair: JuplendPairPosition): SimulateScope {
  const collateralUsd =
    parseFloat(pair.collateralValueUsd.replace(/[^0-9.\-]/g, "")) || 0;
  const debtUsd = parseFloat(pair.debtValueUsd.replace(/[^0-9.\-]/g, "")) || 0;
  return {
    currentCollateralUsd: collateralUsd,
    currentDebtUsd: debtUsd,
    currentLTV: pair.ltv,
    maxLTV: pair.maxLTV,
    liqThreshold: pair.liqThreshold,
  };
}

// Builds the submit-button label from the signed USD deltas. Returns null
// when both sides are effectively zero (button shows "Enter an amount").
export function deriveActionLabel(
  collateralDeltaUsd: number,
  debtDeltaUsd: number,
): string | null {
  const c = collateralDeltaUsd;
  const d = debtDeltaUsd;
  const cZero = Math.abs(c) < 0.0001;
  const dZero = Math.abs(d) < 0.0001;

  if (cZero && dZero) return null;

  const parts: string[] = [];
  if (c > 0) parts.push("Supply");
  else if (c < 0) parts.push("Withdraw");
  if (d > 0) parts.push("Borrow");
  else if (d < 0) parts.push("Repay");

  return parts.join(" & ");
}
