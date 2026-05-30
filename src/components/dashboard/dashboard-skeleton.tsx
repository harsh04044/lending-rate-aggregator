"use client";

import { Skeleton } from "@/src/components/ui/skeleton";

// Mirrors the dashboard layout: TopSplit (net-worth block + health gauge),
// divider, warning banner, protocols grid. Sizes lifted from the rendered
// shape to avoid layout shift when data lands.
export function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      {/* TopSplit: net-worth block (left) + health gauge (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-start">
        {/* NetWorthBlock skeleton */}
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-32 rounded-md" />
          <Skeleton className="h-12 w-64 rounded-md" />
          <div className="flex gap-4 mt-2">
            <Skeleton className="h-16 w-40 rounded-lg" />
            <Skeleton className="h-16 w-40 rounded-lg" />
          </div>
        </div>
        {/* HealthGauge skeleton (circular, ~180px) */}
        <Skeleton className="h-44 w-44 rounded-full" />
      </div>

      {/* Divider — keep the same horizontal rule shape */}
      <Skeleton className="h-px w-full mt-8 mb-8 rounded-md" />

      {/* WarningBanner row */}
      <Skeleton className="h-14 w-full rounded-lg mb-8" />

      {/* ProtocolsSection: section title + 4-card grid + totals row */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32 rounded-md" />
          <Skeleton className="h-4 w-48 rounded-md" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
