export interface Asset {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;

  amount: string; // raw amount (lamports/smallest unit)
  amountUsd: number; // amount × price
  price: number; // protocol-native oracle price

  // rates
  supplyApy?: number; // only on collateral assets
  borrowApy?: number; // only on debt assets

  // risk params from the on-chain reserve / vault config — only meaningful
  // on collateral assets. Both are percentages (0–100).
  maxLTV?: number;
  liqThreshold?: number;

  // Per-protocol tx-building meta (e.g. Kamino reserveAddress). Shape varies
  // per protocol, consumers narrow on protocol context.
  meta?: Record<string, unknown>;
}

export interface RiskParams {
  maxLTV: number;
  liqThreshold: number;
}

export enum Protocol {
  JupLend = "JupLend",
  Kamino = "Kamino",
  Drift = "Drift",
  Save = "Save",
}

export interface NormalizedPosition {
  protocol: Protocol;

  label: string;

  // on-chain address for this obligation/vault — used by history endpoint
  accountAddress: string;

  // assets
  collateral: Asset[];
  debt: Asset[];

  // aggregated USD
  totalCollateralUsd: number;
  totalDebtUsd: number;

  // health: 0-100 scale, 0 = liquidation, 100 = safe
  healthPct: number;

  // net APY across all assets in this obligation (weighted)
  netApy: number;

  // USD-weighted risk params across this obligation's collaterals.
  // null when totalCollateralUsd === 0 (debt-only / dust positions).
  risk: RiskParams | null;

  // protocol-specific metadata for tx building later
  meta?: Record<string, unknown>;
}

export interface ProtocolDistribution {
  protocol: Protocol;
  collateralUsd: number;
  pct: number; // 0-100
  dailyPnl: number;
  atRiskPositions: number;
  monthlySavings: number; // potential monthly savings from switching to a cheaper borrow protocol
}

export interface HealthCardValues {
  netWorth: number; // total collateral USD - total debt USD
  dailyPnl: number; // net daily earnings/costs from rates
  healthPct: number; // debt-weighted average across all positions
  atRiskPositions: number; // total count of positions below 15% health; per-protocol breakdown is in distribution[]
  distribution: ProtocolDistribution[];
}

export interface ProtocolStatus {
  protocol: Protocol;
  ok: boolean;
  error?: string;
  latencyMs: number;
}

export interface DashboardResponse {
  wallet: string;
  healthCard: HealthCardValues;
  positions: NormalizedPosition[];
  protocolStatus: ProtocolStatus[];
  timestamp: number;
}
