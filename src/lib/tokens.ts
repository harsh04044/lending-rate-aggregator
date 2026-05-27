// Curated tokens for the Create Position picker.
//
// We store ONLY the symbol (and a display fallback) here. The mint, decimals,
// name and logoUrl are resolved at runtime via `useTokenList()` from the
// Jupiter verified-tokens API; prices come from `useTokenPrices()` (Jupiter
// price API). This avoids hardcoded mints + stale prices.

export interface CuratedToken {
  symbol: string;
  // Display-only fallback (TokenIcon uses these if the Jupiter list doesn't
  // resolve the symbol — rare for verified tokens).
  iconLetter: string;
  color: string;
}

export const CURATED_TOKENS: CuratedToken[] = [
  { symbol: "SOL", iconLetter: "S", color: "#9945FF" },
  { symbol: "USDC", iconLetter: "U", color: "#2775CA" },
  { symbol: "USDT", iconLetter: "T", color: "#26A17B" },
  { symbol: "JLP", iconLetter: "JLP", color: "#5EEAD4" },
  { symbol: "JupSOL", iconLetter: "jpS", color: "#FFA500" },
  { symbol: "JitoSOL", iconLetter: "jS", color: "#A4F2A0" },
  { symbol: "INF", iconLetter: "INF", color: "#22D3EE" },
  { symbol: "cbBTC", iconLetter: "₿", color: "#F7931A" },
  { symbol: "JUP", iconLetter: "J", color: "#1FC7D4" },
  { symbol: "juicedSOL", iconLetter: "juS", color: "#FF6B6B" },
  { symbol: "syrupUSDC", iconLetter: "syU", color: "#E5A93E" },
];
