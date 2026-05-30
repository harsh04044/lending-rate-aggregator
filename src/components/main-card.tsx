import type { ReactNode } from "react";

export function MainCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className="
        relative rounded-lg overflow-hidden
        bg-[linear-gradient(180deg,var(--color-surface-1)_0%,var(--color-surface-2)_100%)]
        border border-border-base
        shadow-[0_40px_120px_-30px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.03)]
      "
    >
      <div className={`p-5 sm:p-7 ${className}`}>{children}</div>
    </div>
  );
}
