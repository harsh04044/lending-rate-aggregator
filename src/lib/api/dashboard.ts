import type { DashboardResponse } from "@/app/types/main";
import { apiGet } from "./client";

export function fetchDashboard(
  wallet: string,
  init?: { signal?: AbortSignal },
): Promise<DashboardResponse> {
  return apiGet<DashboardResponse>(
    `/api/dashboard/${encodeURIComponent(wallet)}`,
    init,
  );
}
