"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, LogOut, Wallet as WalletIcon } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletPicker } from "./wallet/wallet-picker";
import { ActionButton } from "./ui/action-button";

function shortenAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function WalletPill() {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the connected-state menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  // Disconnected ? "Connect wallet" button (uses shared ActionButton).
  if (!connected || !publicKey) {
    return (
      <>
        <ActionButton
          onClick={() => setPickerOpen(true)}
          disabled={connecting}
          leadingIcon={<WalletIcon size={14} strokeWidth={2.2} />}
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </ActionButton>
        {pickerOpen && <WalletPicker onClose={() => setPickerOpen(false)} />}
      </>
    );
  }

  // Connected ? pill that opens an account menu.
  const addr = publicKey.toBase58();
  const walletIcon = wallet?.adapter.icon;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* noop */
    }
  }

  async function handleDisconnect() {
    setMenuOpen(false);
    try {
      await disconnect();
    } catch {
      /* noop */
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="
          inline-flex items-center gap-2.5 h-10 pl-1.5 pr-3 rounded-full cursor-pointer
          bg-[rgba(10,20,34,0.7)] border border-border-base backdrop-blur-md transition-colors
          hover:border-border-lit
        "
      >
        {walletIcon ? (
          <span className="block w-7 h-7 rounded-full overflow-hidden bg-surface-2 border border-border-base shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={walletIcon}
              alt={wallet?.adapter.name ?? "Wallet"}
              className="w-full h-full object-contain"
            />
          </span>
        ) : (
          <span
            className="
              block rounded-full w-7 h-7
              bg-[radial-gradient(circle_at_30%_30%,#D066FF_0%,#7A5BD6_35%,#2A7FB8_70%,#1DB67D_100%)]
              shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]
            "
          />
        )}
        <span className="font-(family-name:--font-ibm-plex-mono) text-[12.5px] font-semibold tabular-nums tracking-[0.3px] text-text-base">
          {shortenAddress(addr)}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={`text-text-muted transition-transform ${
            menuOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {menuOpen && (
        <div
          className="
            absolute right-0 top-[calc(100%+8px)] z-50 w-70
            rounded-lg bg-surface-1 border border-border-base
            shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.03)]
            overflow-hidden
          "
        >
          <div className="px-4 py-3 border-b border-border-base">
            <div className="font-(family-name:--font-dm-sans) text-[10.5px] font-bold uppercase tracking-[0.06em] text-text-muted">
              Connected
            </div>
            <div className="mt-1 font-(family-name:--font-dm-sans) text-[12.5px] font-semibold text-text-base">
              {wallet?.adapter.name ?? "Wallet"}
            </div>
            <div className="mt-0.5 font-(family-name:--font-ibm-plex-mono) text-[11.5px] font-medium tabular-nums text-text-muted truncate">
              {addr}
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="
              flex w-full items-center gap-2.5 px-4 py-2.5 cursor-pointer
              font-(family-name:--font-dm-sans) text-[12.5px] font-medium text-text-base
              hover:bg-surface-2 transition-colors
            "
          >
            <Copy size={14} strokeWidth={1.8} className="text-text-muted" />
            {copied ? "Copied!" : "Copy address"}
          </button>

          <button
            type="button"
            onClick={handleDisconnect}
            className="
              flex w-full items-center gap-2.5 px-4 py-2.5 cursor-pointer
              font-(family-name:--font-dm-sans) text-[12.5px] font-medium text-danger
              hover:bg-danger/10 transition-colors border-t border-border-base
            "
          >
            <LogOut size={14} strokeWidth={1.8} />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
