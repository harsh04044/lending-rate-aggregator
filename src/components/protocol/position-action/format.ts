// Pure formatters / parsers used by the position-action modal pieces.
// No React, no protocol logic — safe to import from anywhere.

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

// Parses a user-typed decimal string for use in the simulator. Returns 0
// for empty / non-numeric / negative inputs (the modal separately rejects
// zero-amount submits).
export function parseAmt(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function formatBalanceForInput(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const fixed = value.toFixed(Math.min(decimals, 12));
  return fixed.replace(/\.?0+$/, "");
}

export function formatBalanceForHint(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1)
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
