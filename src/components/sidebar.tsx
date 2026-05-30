"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { Home, Zap, PlusSquare, X } from "lucide-react";
import { COLORS } from "@/src/lib/theme";
import { SidebarProtocolsDropdown } from "./sidebar-protocols";
import { useConnectedWallet } from "./wallet/useConnectedWallet";

// ─── Data ─────────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: Home, requiresWallet: false },
  { label: "Optimize", href: "/optimize", icon: Zap, requiresWallet: true },
  {
    label: "Create Position",
    href: "/create-position",
    icon: PlusSquare,
    requiresWallet: true,
  },
] as const;

// ─── NavItem ──────────────────────────────────────────────────────────────────
// Hover is handled entirely by CSS (.sb-nav in globals.css).
// No useState — impossible for hover to persist across navigations.

function NavItem({
  icon: Icon,
  label,
  href,
  active,
  disabled,
  labelStyle,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
  active: boolean;
  disabled: boolean;
  labelStyle: CSSProperties;
}) {
  if (disabled) {
    return (
      <div
        aria-disabled="true"
        title="Connect a wallet to use this page"
        className="sb-nav relative flex items-center gap-3.5 h-14.5 px-3 cursor-not-allowed opacity-40"
      >
        <div className="flex items-center justify-center w-8 h-8 shrink-0">
          <Icon size={20} strokeWidth={2} className="sb-icon" />
        </div>
        <span
          className="sb-label font-ui text-[15px] font-semibold whitespace-nowrap"
          style={labelStyle}
        >
          {label}
        </span>
      </div>
    );
  }

  if (active) {
    return (
      <Link
        href={href}
        className="sb-nav cursor-pointer relative flex items-center gap-3.5 h-14.5 px-3"
      >
        <div className="flex items-center justify-center w-8 h-8 shrink-0">
          <Icon size={20} strokeWidth={2} style={{ color: COLORS.primary }} />
        </div>
        <span
          className="font-ui text-[15px] font-bold whitespace-nowrap"
          style={{ color: "#D4F5E6", ...labelStyle }}
        >
          {label}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="sb-nav relative flex items-center gap-3.5 h-14.5 px-3"
    >
      <div className="flex items-center justify-center w-8 h-8 shrink-0">
        <Icon size={20} strokeWidth={2} className="sb-icon" />
      </div>
      <span
        className="sb-label font-ui text-[15px] font-semibold whitespace-nowrap"
        style={labelStyle}
      >
        {label}
      </span>
    </Link>
  );
}

export function Sidebar({
  open,
  onExpand,
  mobileOpen = false,
  onMobileClose,
}: {
  open: boolean;
  onExpand: (v: boolean) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const { isConnected } = useConnectedWallet();

  // Labels fade in when either: the desktop sidebar is hover-expanded, or
  // the mobile drawer is open (which is always full-width). One state per
  // viewport — they never both fire on the same device.
  const labelsVisible = open || mobileOpen;
  const labelStyle: CSSProperties = {
    opacity: labelsVisible ? 1 : 0,
    transition: labelsVisible
      ? "opacity 180ms ease 80ms"
      : "opacity 100ms ease 0ms",
    pointerEvents: labelsVisible ? "auto" : "none",
  };

  return (
    <aside
      onMouseEnter={() => onExpand(true)}
      onMouseLeave={() => onExpand(false)}
      style={{ borderColor: COLORS.border }}
      className={`
        bg-[linear-gradient(180deg,var(--color-surface-1)_0%,var(--color-surface-2)_100%)]
        fixed left-0 top-0 h-screen z-50 flex flex-col overflow-hidden
        shadow-[2px_0_16px_0_rgba(0,0,0,0.4)]
        transition-[width,transform] duration-300 ease-in-out
        w-70 lg:w-[var(--sidebar-width)]
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0
      `}
    >
      {/* Mobile-only close button */}
      {onMobileClose && (
        <button
          type="button"
          onClick={onMobileClose}
          aria-label="Close menu"
          className="lg:hidden absolute top-4 right-4 z-10 w-9 h-9 rounded-md flex items-center justify-center cursor-pointer hover:bg-white/4 transition-colors"
        >
          <X size={18} className="text-text-muted" />
        </button>
      )}
      <div className="w-70 h-full flex flex-col">
        {/* ── Logo ── */}
        <div className="w-full flex items-center gap-2.5 px-3 pt-5 pb-4">
          <div className="relative flex items-center justify-center w-12 h-12 shrink-0">
            <Image
              src="/arvexa-logo.svg"
              alt="Arvexa"
              width={48}
              height={48}
              priority
            />
          </div>

          <div
            className="flex flex-col leading-tight overflow-hidden"
            style={labelStyle}
          >
            <span
              className="text-[26px] font-semibold tracking-[0.18em] whitespace-nowrap"
              style={{
                color: "#FFFFFF",
                fontFamily: "'Space Grotoesk', sans-serif",
              }}
            >
              Arvexa
            </span>
          </div>
        </div>

        {/* ── Nav items ── */}
        <nav className="w-full flex flex-col gap-3.5">
          {NAV_ITEMS.map((item) => (
            <NavItem
              key={item.href}
              icon={item.icon}
              label={item.label}
              href={item.href}
              active={pathname === item.href}
              disabled={item.requiresWallet && !isConnected}
              labelStyle={labelStyle}
            />
          ))}
        </nav>

        {/* ── Protocols ── */}
        <div className="mt-6 flex flex-col flex-1 min-h-0">
          <SidebarProtocolsDropdown
            labelStyle={labelStyle}
            disabled={!isConnected}
          />
        </div>

        <div className="h-5" />
      </div>
    </aside>
  );
}
