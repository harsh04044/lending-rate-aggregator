"use client";

import { useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Layers } from "lucide-react";
import { COLORS } from "@/src/lib/theme";
import { ProtocolIcon } from "./icons/token-icons";

// ─── Data ────────────────────────────────────────────────────────────────────

type Protocol = { name: string; slug: string; color: string };

const PROTOCOLS: Protocol[] = [
  { name: "Kamino", slug: "kamino", color: "#7c3aed" },
  { name: "Juplend", slug: "juplend", color: "#1FC7D4" },
  // { name: "Drift", slug: "drift", color: "#2563eb" }, // hidden in UI
  { name: "Save", slug: "save", color: "#1DB67D" },
];

// ─── ProtocolRow ─────────────────────────────────────────────────────────────
// Hover handled entirely by CSS (.sb-proto in globals.css).
// Active items render a different structure with inline styles — no CSS hover class.

export function ProtocolRow({
  protocol,
  active,
  disabled,
  labelStyle,
}: {
  protocol: Protocol;
  active: boolean;
  disabled?: boolean;
  labelStyle: CSSProperties;
}) {
  if (disabled) {
    return (
      <div
        aria-disabled="true"
        title="Connect a wallet to view protocol details"
        className="sb-proto relative flex items-center gap-3.5 w-full h-14.5 px-2.5 text-left cursor-not-allowed opacity-40"
      >
        <div className="w-9 h-9 flex items-center justify-center shrink-0 overflow-hidden">
          <ProtocolIcon name={protocol.name} size={32} />
        </div>
        <span
          className="sb-proto-label font-ui text-[13.5px] font-semibold whitespace-nowrap"
          style={labelStyle}
        >
          {protocol.name}
        </span>
      </div>
    );
  }

  if (active) {
    return (
      <Link href={`/protocols/${protocol.slug}`}>
        <div
          className="relative z-1! flex items-center gap-3.5 w-full h-14.5 px-3 text-left cursor-pointer"
          style={{
            background: "rgba(16,45,38,0.7)",
          }}
        >
          <div className="w-9 h-9 flex items-center justify-center shrink-0 overflow-hidden">
            <ProtocolIcon name={protocol.name} size={32} />
          </div>

          <span
            className="font-ui text-[15px] font-semibold whitespace-nowrap"
            style={{
              color: "#D4F5E6",
              ...labelStyle,
            }}
          >
            {protocol.name}
          </span>

          <span
            className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              background: COLORS.primary,
              ...labelStyle,
            }}
          />
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/protocols/${protocol.slug}`}>
      <div className="sb-proto relative flex items-center gap-3.5 w-full h-14.5 px-2.5 text-left cursor-pointer">
        <div className="w-9 h-9 flex items-center justify-center shrink-0 overflow-hidden">
          <ProtocolIcon name={protocol.name} size={32} />
        </div>

        <span
          className="sb-proto-label font-ui text-[13.5px] font-semibold whitespace-nowrap"
          style={labelStyle}
        >
          {protocol.name}
        </span>
      </div>
    </Link>
  );
}

export function SidebarProtocolsDropdown({
  labelStyle,
  disabled = false,
}: {
  labelStyle: CSSProperties;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header row — stays put; list below it scrolls */}
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        className="flex items-center gap-3.5 w-full h-14.5 px-3 border cursor-pointer shrink-0"
        style={{
          background: hovered ? "rgba(20,28,42,0.96)" : "transparent",
          borderColor: hovered ? "rgba(255,255,255,0.04)" : "transparent",
          transitionProperty: "background-color, border-color",
          transitionDuration: "200ms",
          transitionTimingFunction: "ease",
        }}
      >
        <div
          className="w-9 h-9 rounded-sm flex items-center justify-center shrink-0"
          style={{
            background: "rgba(29,182,125,0.08)",
            // border: "1px solid rgba(29,182,125,0.20)",
          }}
        >
          <Layers size={20} strokeWidth={2} style={{ color: COLORS.primary }} />
        </div>

        <span
          className="font-ui text-[14px] font-bold tracking-[0.22em] uppercase whitespace-nowrap"
          style={{ color: COLORS.text, ...labelStyle }}
        >
          Protocols
        </span>

        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.24, ease: "easeInOut" }}
          className="flex items-center justify-center"
          // style={labelStyle}
        >
          <ChevronDown size={20} className="text-text-bright" />
        </motion.div>
      </motion.button>

      {/* Expanded list — scrolls within remaining sidebar height */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="protocols-list"
            initial={{ flexGrow: 0, opacity: 0 }}
            animate={{ flexGrow: 1, opacity: 1 }}
            exit={{ flexGrow: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            className="min-h-0 overflow-y-scroll custom-scrollbar"
          >
            <div className="flex flex-col gap-3 mt-4 pb-1">
              {PROTOCOLS.map((p) => (
                <ProtocolRow
                  key={p.name}
                  protocol={p}
                  active={pathname === `/protocols/${p.slug}`}
                  disabled={disabled}
                  labelStyle={labelStyle}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
