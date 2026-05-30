"use client";

import { MainCard } from "@/src/components/main-card";
import { Skeleton } from "@/src/components/ui/skeleton";

// Mirrors the rendered protocol page structure 1:1: protocol header,
// 4 top-stat cards, tab nav, and the overview-shaped content area
// (two section lists + two summary blocks). Sizes lifted from the real
// components so the layout doesn't shift when data lands.
export function ProtocolPageSkeleton() {
  return (
    <div className="relative z-10 animate-pulse">
      {/* Header */}
      <div className="flex items-start justify-between mb-7">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-[35px] w-[35px] rounded-md" />
          <Skeleton className="h-9 w-44 rounded-md" />
        </div>
        <Skeleton className="h-10 w-36 rounded-md" />
      </div>

      <MainCard>
        {/* 4 top-stat cards — match the real h-[88px]-ish rounded-lg shape */}
        <div className="flex gap-4 mb-8">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="flex-1 h-[88px] rounded-lg" />
          ))}
        </div>

        {/* Tab nav — same width/height as the real button row */}
        <div className="mb-8">
          <Skeleton className="h-[38px] w-80 rounded-md" />
        </div>

        {/* Overview content — collateral list, debt list, summary blocks */}
        <div className="flex flex-col gap-8">
          <SectionSkeleton titleWidth="w-28" rowCount={2} />
          <SectionSkeleton titleWidth="w-20" rowCount={1} />
          <Skeleton className="h-[160px] w-full rounded-lg" />
          <Skeleton className="h-[140px] w-full rounded-lg" />
        </div>
      </MainCard>
    </div>
  );
}

function SectionSkeleton({
  titleWidth,
  rowCount,
}: {
  titleWidth: string;
  rowCount: number;
}) {
  return (
    <section className="space-y-3">
      <Skeleton className={`h-4 ${titleWidth} rounded-md`} />
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: rowCount }).map((_, i) => (
          <Skeleton key={i} className="h-[68px] w-full rounded-lg" />
        ))}
      </div>
    </section>
  );
}
