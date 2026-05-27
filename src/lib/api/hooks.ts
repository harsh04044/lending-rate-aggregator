// TODO FRONTEND: We should prolly use something like react-query for this, but for now this is fine.

"use client";

import { useEffect, useState } from "react";
import type { DashboardResponse } from "@/app/types/main";
import { fetchDashboard } from "./dashboard";

export interface UseDashboardResult {
  data: DashboardResponse | null;
  error: Error | null;
  isLoading: boolean;
}

enum Status {
  Idle,
  Loading,
  Success,
  Error,
}

export function useDashboard(wallet: string | null): UseDashboardResult {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<Status>(Status.Idle);

  useEffect(() => {
    if (!wallet) {
      setData(null);
      setError(null);
      setStatus(Status.Idle);
      return;
    }

    // Use a `cancelled` flag instead of AbortController. Next.js 16's dev
    // overlay surfaces fetch's AbortError as a runtime error even when the
    // promise chain handles it; ignoring the result is functionally
    // equivalent and stays silent. Stale fetches still complete in the
    // background but their setState is dropped.
    let cancelled = false;
    setStatus(Status.Loading);
    setError(null);

    fetchDashboard(wallet)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setStatus(Status.Success);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus(Status.Error);
      });

    return () => {
      cancelled = true;
    };
  }, [wallet]);

  if (!wallet) {
    return { data: null, error: null, isLoading: false };
  }

  return { data, error, isLoading: status === Status.Loading };
}
