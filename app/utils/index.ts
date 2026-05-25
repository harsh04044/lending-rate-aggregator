/**
 * Convert a raw on-chain integer string to a decimal number.
 * Uses BigInt arithmetic to avoid precision loss for large amounts
 * (e.g. SOL with 9 decimals can exceed Number.MAX_SAFE_INTEGER).
 */
export function rawToDecimal(raw: string, decimals: number): number {
  const factor = BigInt(10) ** BigInt(decimals);
  const rawBig = BigInt(raw);
  const whole = rawBig / factor;
  const frac = rawBig % factor;
  return Number(whole) + Number(frac) / Number(factor);
}
