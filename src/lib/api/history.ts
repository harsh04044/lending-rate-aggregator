import type { HistoryResponse } from "@/app/lib/discriminators";
import type { Protocol } from "@/app/types/main";
import { apiGet } from "./client";

export function fetchHistory(
  protocol: Protocol,
  wallet: string,
  init?: { signal?: AbortSignal; noCache?: boolean },
): Promise<HistoryResponse> {
  const params = new URLSearchParams({ wallet });
  if (init?.noCache) params.set("noCache", "1");
  return apiGet<HistoryResponse>(
    `/api/history/${encodeURIComponent(protocol)}?${params.toString()}`,
    { signal: init?.signal },
  );
}
