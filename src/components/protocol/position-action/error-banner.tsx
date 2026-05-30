import type { SubmitError } from "@/src/lib/tx/action-errors";

// Renders a SubmitError as a styled banner. Specialized variants get rich
// JSX (mono-font numbers, structured layout); the `plain` variant just
// shows the message string.
export function SubmitErrorBanner({ error }: { error: SubmitError }) {
  if (error.kind === "insufficient-debt-balance") {
    return (
      <div className="rounded-md bg-danger/10 border border-danger/25 px-4 py-3 mb-6 font-(family-name:--font-dm-sans) text-[12px] text-danger break-words">
        <div className="font-bold mb-1.5">
          Not enough {error.symbol} to fully repay.
        </div>
        <div className="font-semibold opacity-80 mb-2 font-(family-name:--font-ibm-plex-mono) text-[11px]">
          Wallet:{" "}
          <span className="font-bold opacity-100">
            {error.walletAmount} {error.symbol}
          </span>{" "}
          · Debt:{" "}
          <span className="font-bold opacity-100">
            {error.debtAmount} {error.symbol}
          </span>
        </div>
        <div className="font-semibold leading-relaxed">
          Add{" "}
          <span className="font-bold font-(family-name:--font-ibm-plex-mono)">
            ~{error.topUpAmount} {error.symbol}
          </span>{" "}
          to your wallet to close the position, or repay at most{" "}
          <span className="font-bold font-(family-name:--font-ibm-plex-mono)">
            {error.partialRepayAmount} {error.symbol}
          </span>{" "}
          to keep it open.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md bg-danger/10 border border-danger/25 px-4 py-3 mb-6 font-(family-name:--font-dm-sans) text-[12px] text-danger break-words">
      <span className="font-semibold">{error.message}</span>
    </div>
  );
}

// Lightweight reusable banner used by sim-side validation messages
// (LTV exceeded, over-withdraw, over-repay). Same styling as
// SubmitErrorBanner's plain variant so the modal looks consistent.
export function ValidationBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-danger/10 border border-danger/25 px-4 py-2.5 mb-6 font-(family-name:--font-dm-sans) text-[12px] font-semibold text-danger">
      {message}
    </div>
  );
}
