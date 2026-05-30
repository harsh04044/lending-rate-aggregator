"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "./sidebar";
import { SIDEBAR_COLLAPSED, SIDEBAR_EXPANDED } from "@/src/lib/theme";

export function SidebarShell({ children }: { children: React.ReactNode }) {
  // Hover-expand state — desktop only.
  const [open, setOpen] = useState(false);
  // Drawer state — mobile only.
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close the mobile drawer on navigation so users don't have to tap
  // the close button after picking a link.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // CSS variable so both the sidebar and the main column track the same
  // desktop width. Mobile ignores it via `lg:` overrides.
  const desktopWidth = open ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED;

  return (
    <div
      className="min-h-screen"
      style={
        {
          background: "#020814",
          ["--sidebar-width" as string]: `${desktopWidth}px`,
        } as React.CSSProperties
      }
    >
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 55% 38%, rgba(4,23,42,0.35) 0%, transparent 100%)",
        }}
      />

      {/* Mobile-only top hamburger. Hidden at lg+ where the sidebar is
          permanently visible. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="lg:hidden fixed top-4 left-4 z-40 w-10 h-10 rounded-md flex items-center justify-center bg-surface-1 border border-border-base shadow-[0_4px_12px_rgba(0,0,0,0.3)] cursor-pointer"
      >
        <Menu size={20} className="text-text-base" />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          aria-hidden
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity"
        />
      )}

      <Sidebar
        open={open}
        onExpand={setOpen}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <main className="relative min-h-screen transition-[margin-left] duration-300 ease-in-out lg:ml-[var(--sidebar-width)]">
        {/* Extra top padding on mobile to clear the floating hamburger. */}
        <div className="px-4 sm:px-6 lg:px-10 py-6 pt-10 lg:pt-6">
          <div className="max-w-5xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
