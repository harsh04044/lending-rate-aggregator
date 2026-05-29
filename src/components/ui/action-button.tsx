"use client";

import type { ReactNode } from "react";

export function ActionButton({
  children,
  onClick,
  disabled,
  type = "button",
  leadingIcon,
  trailingIcon,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  className?: string;
}) {
  const enabled = !disabled;
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-md font-(family-name:--font-dm-sans) font-bold text-[14px] hover:shadow-[0_6px_16px_rgba(29,182,125,0.20)] transition-all ${
        enabled
          ? "cursor-pointer bg-[linear-gradient(135deg,#1DB67D_0%,#27C98C_100%)] text-surface-2 border border-accent/30"
          : "cursor-not-allowed bg-accent/18 text-text-muted border border-accent/12 opacity-75"
      } ${className}`}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
