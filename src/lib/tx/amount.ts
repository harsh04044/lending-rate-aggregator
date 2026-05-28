import BN from "bn.js";

// Multiplies a decimal string ("1.5") by 10^decimals, rounding down, and
// returns a BN of raw token units. Avoids floating-point drift on large
// amounts. Returns BN(0) for empty / non-numeric input.
export function toRawAmount(input: string, decimals: number): BN {
  const trimmed = input.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return new BN(0);
  const [whole = "0", frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");
  if (!combined) return new BN(0);
  return new BN(combined);
}
