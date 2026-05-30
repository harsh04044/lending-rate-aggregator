"use client";

import type { LucideIcon } from "lucide-react";
import { WalletPill } from "./wallet-pill";

export function PageHeader({
  title,
  icon: Icon,
}: {
  title: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
      {/* Wallet pill: rendered first on mobile so it sits above the title;
          on desktop it floats to the right of the title via flex-row. */}
      <div className="flex items-center gap-3 shrink-0 self-end sm:order-2">
        <WalletPill />
      </div>

      <div className="flex items-center gap-2 min-w-0 sm:order-1">
        <div
          className="
            flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-md shrink-0
            border border-border-base
            shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]
          "
        >
          <Icon
            size={22}
            strokeWidth={1.8}
            className="text-accent sm:hidden"
          />
          <Icon
            size={24}
            strokeWidth={1.8}
            className="text-accent hidden sm:block"
          />
        </div>
        <h1 className="font-(family-name:--font-dm-sans) text-[24px] sm:text-[36px] font-bold tracking-[-0.02em] leading-[1.1] mt-0.5 text-text-bright truncate">
          {title}
        </h1>
      </div>
    </div>
  );
}
