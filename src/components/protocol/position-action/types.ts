import type {
  CollateralAsset,
  DebtAsset,
  JuplendPairPosition,
} from "@/app/(dashboard)/protocols/[slug]/page";

// What the modal is operating on. Picked at the row click site (overview).
//   - "collateral" / "debt" → per-asset modal (Save/Kamino/Drift today)
//   - "pair"               → per-position modal (JupLend today)
export type ActionTarget =
  | { kind: "collateral"; asset: CollateralAsset }
  | { kind: "debt"; asset: DebtAsset }
  | { kind: "pair"; pair: JuplendPairPosition };

// Pair modal segmented-tabs value. Toggles which two inputs are shown.
export type PairTab = "supply-borrow" | "repay-withdraw";
