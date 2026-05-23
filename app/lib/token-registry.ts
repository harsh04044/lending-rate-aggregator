// ─── Jupiter Token Registry ──────────────────────────────────────────────────
// Shared across all fetchers for token logos and symbols.
// Cached in memory — one fetch, reused everywhere.

const JUPITER_TOKEN_LIST_API =
  "https://lite-api.jup.ag/tokens/v2/tag?query=verified";

interface JupiterToken {
  id: string; // mint address
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
}

let tokenMap: Map<string, JupiterToken> | null = null;
let tokenMapTimestamp = 0;
const TOKEN_MAP_TTL = 1000 * 60 * 2400; // 2400 minutes (40 hours)

async function loadTokenMap(): Promise<Map<string, JupiterToken>> {
  const now = Date.now();

  if (tokenMap && now - tokenMapTimestamp < TOKEN_MAP_TTL) {
    return tokenMap;
  }

  try {
    const tokens: JupiterToken[] = await fetch(JUPITER_TOKEN_LIST_API).then(
      (res) => {
        if (!res.ok) throw new Error(`Jupiter token list error: ${res.status}`);
        return res.json();
      },
    );

    tokenMap = new Map(tokens.map((t) => [t.id, t]));
    tokenMapTimestamp = now;
  } catch (err) {
    console.warn("[token-registry] Failed to load Jupiter token list:", err);
    if (!tokenMap) tokenMap = new Map();
  }

  return tokenMap;
}

export async function getTokenInfo(
  mint: string,
): Promise<{ symbol: string; name: string; logoUrl: string } | null> {
  const map = await loadTokenMap();
  const token = map.get(mint);
  if (!token) return null;

  return {
    symbol: token.symbol,
    name: token.name,
    logoUrl: token.icon ?? "",
  };
}

export async function getTokenLogo(mint: string): Promise<string> {
  const info = await getTokenInfo(mint);
  return info?.logoUrl ?? "";
}

export async function getTokenSymbol(mint: string): Promise<string> {
  const info = await getTokenInfo(mint);
  return info?.symbol ?? mint.slice(0, 6);
}
