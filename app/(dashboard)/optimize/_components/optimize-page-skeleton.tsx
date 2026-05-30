"use client";

import { PageHeader } from "@/src/components/page-header";
import { MainCard } from "@/src/components/main-card";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Zap } from "lucide-react";

// Optimize page during initial position load. Mirrors the eventual content
// shape: position picker (left column-ish) plus a from→to comparison area
// underneath. We don't try to render the comparison's nested structure —
// just two big slab placeholders since they're rendered inside the same
// MainCard.
export function OptimizePageSkeleton() {
  return (
    <div className="relative z-10">
      <PageHeader title="Optimize" icon={Zap} />
      <MainCard>
        <div className="animate-pulse space-y-6">
          {/* Section title + select row */}
          <div className="space-y-3">
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>

          {/* From / To columns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Skeleton className="h-[260px] w-full rounded-lg" />
            <Skeleton className="h-[260px] w-full rounded-lg" />
          </div>

          {/* Comparison summary block */}
          <Skeleton className="h-[180px] w-full rounded-lg" />
        </div>
      </MainCard>
    </div>
  );
}
