import { PROGRAM_ID as KAMINO_PROGRAM_ID } from "@kamino-finance/klend-sdk";
import { Protocol } from "../types/main";
import { SAVE_PROGRAM_ID } from "./solend-sdk/constants";
import { createHash } from "crypto";

export type ActionType =
  | "deposit"
  | "borrow"
  | "repay"
  | "withdraw"
  | "refinance";

export interface TokenDetail {
  tokenSymbol: string;
  tokenAmount: string; // human-readable
  tokenMint: string;
  logoUrl: string;
  tokenPrice: number;
}

export interface HistoryEntry {
  timestamp: number;
  actionType: ActionType;
  tokens: TokenDetail[];
  signature: string; // tx signature
  accountAddress: string; // which position/obligation this belongs to
}

export interface HistoryResponse {
  wallet: string;
  protocol: Protocol;
  entries: HistoryEntry[];
}

export const JUPLEND_VAULTS_PROGRAM =
  "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi";

// operate discriminator from IDL: [217, 106, 208, 99, 116, 151, 42, 135]
export const JUPLEND_OPERATE_DISC = Buffer.from([
  217, 106, 208, 99, 116, 151, 42, 135,
]).toString("hex");

export function isJupLendOperate(
  programId: string,
  instructionData: Buffer,
): boolean {
  if (programId !== JUPLEND_VAULTS_PROGRAM) return false;
  if (instructionData.length < 8) return false;
  return (
    instructionData.subarray(0, 8).toString("hex") === JUPLEND_OPERATE_DISC
  );
}

export const SAVE_INSTRUCTION_MAP: Record<number, ActionType> = {
  14: "deposit", // depositReserveLiquidityAndObligationCollateral
  10: "borrow", // borrowObligationLiquidity
  11: "repay", // repayObligationLiquidity
  13: "withdraw", // withdrawObligationCollateralAndRedeemReserveLiquidity
};

export const KAMINO_DISCRIMINATORS = {
  // depositReserveLiquidityAndObligationCollateral
  deposit: Buffer.from([129, 199, 4, 2, 222, 39, 26, 46]).toString("hex"),
  // borrowObligationLiquidity
  borrow: Buffer.from([121, 127, 18, 204, 73, 245, 225, 65]).toString("hex"),
  // repayObligationLiquidity
  repay: Buffer.from([145, 178, 13, 225, 76, 240, 147, 72]).toString("hex"),
  // withdrawObligationCollateralAndRedeemReserveCollateral
  withdraw: Buffer.from([75, 93, 93, 220, 34, 150, 218, 196]).toString("hex"),
} as const;

// Drift Anchor discriminators
// Drift has two relevant instructions that each map to TWO action types:
// - deposit: covers both "deposit" and "repay" (depending on reduceOnly flag + existing debt)
// - withdraw: covers both "withdraw" and "borrow" (depending on reduceOnly flag + existing balance)
function anchorDisc(name: string): string {
  return createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8)
    .toString("hex");
}

export const DRIFT_DISCRIMINATORS = {
  deposit: anchorDisc("deposit"), // deposit | repay
  withdraw: anchorDisc("withdraw"), // withdraw | borrow
};

// Account indices from Drift SDK (deposit/withdraw instructions)
// [state, user, userStats, authority, spotMarketVault, userTokenAccount, tokenProgram, ...]
// The user account PDA is at index 1 for both instructions.
export const DRIFT_USER_ACCOUNT_INDEX = 1;

export const PROGRAM_IDS = {
  juplend: JUPLEND_VAULTS_PROGRAM,
  drift: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
  save: SAVE_PROGRAM_ID.toString(),
  kamino: KAMINO_PROGRAM_ID,
};
