import { NormalizedPosition, Protocol, RiskParams } from "./main";

export interface DebtSaving {
  debtMint: string;
  debtSymbol: string;
  debtAmountUsd: number;
  currentProtocol: Protocol;
  currentBorrowApr: number;
  bestProtocol: Protocol;
  bestBorrowApr: number;
  monthlySavingsUsd: number;
  positionId?: number; // JupLend vault position ID — used for refinance targeting
  bestCollateralMint?: string; // for JupLend refinance targeting
  bestVaultId?: number;
}

export interface AggregatedToken {
  mint: string;
  symbol: string;
  logoUrl: string;
  decimals: number;
  totalAmount: number; // human-readable
  totalAmountUsd: number;

  // When the protocol is per-vault aggregated (i.e. one row per
  // (mint, position) instead of per (mint)), these identify the source
  // position so the action modal knows which obligation/vault to operate on.
  vaultId?: number;
  accountAddress?: string;
  supplyApy?: number;
  borrowApy?: number;

  // Per-protocol tx-building meta. The action handler picks fields out by
  // protocol.slug. Carrying it here keeps per-asset rows actionable without
  // a second lookup.
  meta?: Record<string, unknown>;
}

export interface ProtocolSummary {
  totalCollateralUsd: number;
  totalDebtUsd: number;
  netApy: number; // weighted net APY as percentage
  netApyUsd: number; // annual $ value of net APY
  healthPct: number; // debt-weighted average health across positions
  // USD-weighted risk params across every collateral asset on this protocol.
  // null when totalCollateralUsd === 0.
  risk: RiskParams | null;
  collateral: AggregatedToken[];
  debt: AggregatedToken[];
  positions: NormalizedPosition[];
}

export interface SavingsResponse {
  wallet: string;
  protocol: Protocol;
  summary: ProtocolSummary;
  totalMonthlySavings: number | null; // null if no savings found
  savings: DebtSaving[];
}
