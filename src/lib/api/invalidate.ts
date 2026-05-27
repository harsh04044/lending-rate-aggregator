import { Protocol } from "@/app/types/main";

// Tells the backend to drop its cached positions for this wallet. Call
// after a successful, *confirmed* tx — buildAndSendV0Tx waits for
// confirmation by default, so awaiting that and then calling this gives
// the next savings/dashboard fetch fresh on-chain data.
//
// `protocols` narrows invalidation to specific protocols. Omit it to drop
// the entire wallet entry.
export async function invalidatePositionsCache(
  wallet: string,
  protocols?: Protocol[],
): Promise<void> {
  try {
    await fetch("/api/cache/invalidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, protocols }),
    });
  } catch (err) {
    // Cache invalidation is best-effort: the user will see stale data for
    // up to the cache TTL, but the tx itself already landed. Don't surface
    // the failure as a tx error.
    console.warn("[invalidatePositionsCache] failed:", err);
  }
}