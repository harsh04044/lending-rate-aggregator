"use client";

import type { ReactNode } from "react";

export type SegmentedTab<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: ReadonlyArray<SegmentedTab<T>>;
  value: T | null;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex rounded-md overflow-hidden border border-border-base bg-white/2 w-full ${className}`}
    >
      {tabs.map((t) => {
        const active = t.value === value && !t.disabled;
        const tone = t.disabled
          ? "text-text-muted/60 opacity-80 cursor-not-allowed"
          : active
            ? "text-text-base bg-accent/10 cursor-pointer"
            : "text-text-muted cursor-pointer";
        return (
          <button
            key={t.value}
            type="button"
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.value)}
            className={`flex-1 px-3 py-2.5 font-(family-name:--font-dm-sans) text-[14px] font-semibold select-none transition-all ${tone}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
