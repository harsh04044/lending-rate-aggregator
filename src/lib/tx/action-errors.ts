// Structured errors that protocol-specific submit handlers throw. The
// position-action modal renders these as rich banners (vs falling back to a
// generic single-string banner for plain Errors).
//
// Add a new variant here when a handler needs the modal to render something
// more structured than a plain string.

export type SubmitError =
  | { kind: "plain"; message: string }
  | {
      kind: "insufficient-debt-balance";
      symbol: string;
      walletAmount: string;
      debtAmount: string;
      topUpAmount: string;
      partialRepayAmount: string;
    };

export class InsufficientDebtBalanceError extends Error {
  constructor(
    public readonly payload: Extract<
      SubmitError,
      { kind: "insufficient-debt-balance" }
    >,
  ) {
    super(`Insufficient ${payload.symbol} balance`);
  }
}

export const GENERIC_TX_FAILURE_MESSAGE =
  "Transaction failed. Something went wrong, please try again.";

export function toSubmitError(err: unknown): SubmitError {
  if (err instanceof InsufficientDebtBalanceError) return err.payload;
  return { kind: "plain", message: GENERIC_TX_FAILURE_MESSAGE };
}
