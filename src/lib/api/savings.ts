import type { SavingsResponse } from "@/app/types/savings";
import type { Protocol } from "@/app/types/main";
import { apiGet } from "./client";

export function fetchSavings(
  protocol: Protocol,
  wallet: string,
  init?: { signal?: AbortSignal; noCache?: boolean },
): Promise<SavingsResponse> {
  const params = new URLSearchParams({ wallet });
  if (init?.noCache) params.set("noCache", "1");
  return apiGet<SavingsResponse>(
    `/api/savings/${encodeURIComponent(protocol)}?${params.toString()}`,
    { signal: init?.signal },
  );
}
