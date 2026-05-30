"use client";

import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { TokenIcon } from "@/src/components/icons/token-icons";
import { Title4 } from "@/src/components/ui/title-4";
import { fmtAmt, fmtUsd } from "@/src/lib";
import { useClickOutside } from "./data";

export function ProtocolBadge({
  color,
  name,
  size = 22,
}: {
  color: string;
  name: string;
  size?: number;
}) {
  return (
    <div
      className="rounded-md flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        background: color + "2a",
        border: `1px solid ${color}55`,
      }}
    >
      <span
        className="font-(family-name:--font-dm-sans) font-bold"
        style={{ color, fontSize: Math.round(size / 2) - 1 }}
      >
        {name[0]}
      </span>
    </div>
  );
}

export function MetricRow({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  const valueClass = warn
    ? "text-danger"
    : highlight
      ? "text-accent"
      : "text-text-base";
  return (
    <div className="flex items-center justify-between h-9">
      <span className="font-(family-name:--font-dm-sans) text-[12px] font-semibold tracking-[0.06em] text-text-dim">
        {label}
      </span>
      <span
        className={`font-(family-name:--font-ibm-plex-mono) text-[13px] font-semibold ${valueClass}`}
      >
        {value}
      </span>
    </div>
  );
}

export interface AssetDropdownOption {
  symbol: string;
  amount: number;
  usd: number;
  logoUrl?: string;
}

export function AssetDropdown({
  label,
  value,
  options,
  onChange,
  onClear,
  placeholder,
}: {
  label: string;
  value: string | null;
  options: AssetDropdownOption[];
  onChange: (v: string) => void;
  onClear?: () => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [clearHover, setClearHover] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const selected = value ? options.find((o) => o.symbol === value) : null;
  const showClear = !!onClear && !!selected;

  return (
    <div ref={ref} className="space-y-1.5 relative flex-1 min-w-42.5">
      <Title4 text={label} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-12 flex items-center gap-2.5 px-3 py-2 rounded-sm transition-colors cursor-pointer bg-surface-2 text-text-base"
      >
        {selected ? (
          <>
            <TokenIcon
              symbol={selected.symbol}
              logoUrl={selected.logoUrl}
              size={22}
            />
            <div className="flex flex-col gap-y-0.5 items-start min-w-0">
              <span className="font-(family-name:--font-ibm-plex-mono) text-[13px] font-semibold leading-tight">
                {fmtAmt(selected.amount)} {selected.symbol}
              </span>
              <span className="font-(family-name:--font-ibm-plex-mono) text-[10px] leading-tight text-text-muted">
                {fmtUsd(selected.usd)}
              </span>
            </div>
          </>
        ) : (
          <span className="font-(family-name:--font-dm-sans) text-[12px] text-text-muted">
            {placeholder ?? "Select asset…"}
          </span>
        )}
        {showClear ? (
          <div
            className={`ml-auto shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors duration-150 ${clearHover ? "bg-white/8" : "bg-transparent"}`}
            onMouseEnter={() => setClearHover(true)}
            onMouseLeave={() => setClearHover(false)}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
              setOpen(false);
              setClearHover(false);
            }}
          >
            <X
              size={11}
              strokeWidth={2.2}
              className={`transition-colors duration-150 ${clearHover ? "text-text-dim" : "text-text-muted"}`}
            />
          </div>
        ) : (
          <ChevronDown
            size={12}
            className={`ml-auto shrink-0 text-text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {open && (
        <div className="space-y-0.5 absolute left-0 right-0 z-40 rounded-sm bg-surface-2 overflow-y-auto custom-scrollbar max-h-48 sm:max-h-60 shadow-[0_10px_28px_rgba(0,0,0,0.40)]">
          {options.map((opt) => {
            const isSelected = opt.symbol === value;
            return (
              <button
                key={opt.symbol}
                type="button"
                onClick={() => {
                  onChange(opt.symbol);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors cursor-pointer text-text-base ${isSelected ? "bg-accent/6" : "bg-transparent"}`}
              >
                <TokenIcon
                  symbol={opt.symbol}
                  logoUrl={opt.logoUrl}
                  size={22}
                />
                <div className="flex flex-col items-start min-w-0">
                  <span className="font-(family-name:--font-ibm-plex-mono) text-[12px] font-semibold leading-tight">
                    {fmtAmt(opt.amount)} {opt.symbol}
                  </span>
                  <span className="font-(family-name:--font-ibm-plex-mono) text-[10px] leading-tight text-text-muted">
                    {fmtUsd(opt.usd)}
                  </span>
                </div>
                {isSelected && (
                  <Check
                    size={12}
                    strokeWidth={2.5}
                    className="ml-auto shrink-0 text-accent"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
