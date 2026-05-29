"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ExternalLink, Loader2, X } from "lucide-react";
import {
  useWallet,
  type Wallet,
} from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { MainCard } from "@/src/components/main-card";
import { Title3 } from "@/src/components/ui/title-3";
import { Title4 } from "@/src/components/ui/title-4";

// ── Modal ─────────────────────────────────────────────────────────────────

export function WalletPicker({ onClose }: { onClose: () => void }) {
  const { wallets, select, connect, connecting, connected, wallet } =
    useWallet();
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Auto-close when a connection completes from inside the modal.
  useEffect(() => {
    if (connected && pendingName) onClose();
  }, [connected, pendingName, onClose]);

  // When the user clicks a wallet we call `select`, then connect on the
  // following render once the adapter has been swapped in.
  useEffect(() => {
    if (!pendingName) return;
    if (!wallet || wallet.adapter.name !== pendingName) return;
    let cancelled = false;
    connect().catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : "Failed to connect");
      setPendingName(null);
    });
    return () => {
      cancelled = true;
    };
  }, [wallet, pendingName, connect]);

  const { detected, other } = useMemo(() => splitWallets(wallets), [wallets]);

  function handlePick(w: Wallet) {
    setError(null);
    if (w.readyState === WalletReadyState.NotDetected) {
      const url = w.adapter.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    setPendingName(w.adapter.name);
    select(w.adapter.name);
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center backdrop-blur-md">
      <div className="absolute inset-0 bg-surface-0/72" onClick={onClose} />

      <MainCard className="p-6! max-h-[70vh] rounded-lg! overflow-y-auto  custom-scrollbar w-110 max-w-[calc(100vw-40px)] bg-white/2!">
        <div>
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <Title3 text="Connect a wallet" />
            <X
              size={22}
              strokeWidth={2}
              onClick={onClose}
              className="cursor-pointer text-text-muted"
            />
          </div>

          {/* Wallet list (scrolls when many wallets are registered) */}
          <div className="pr-1 -mr-1">
            {detected.length > 0 && (
              <section className="mb-3">
                <SectionLabel>Detected</SectionLabel>
                <ul className="flex flex-col gap-1.5">
                  {detected.map((w) => (
                    <WalletRow
                      key={w.adapter.name}
                      wallet={w}
                      detected
                      pending={pendingName === w.adapter.name && connecting}
                      onSelect={() => handlePick(w)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {other.length > 0 && (
              <section>
                <SectionLabel>
                  {detected.length > 0 ? "Other wallets" : "Available wallets"}
                </SectionLabel>
                <ul className="flex flex-col gap-1.5">
                  {other.map((w) => (
                    <WalletRow
                      key={w.adapter.name}
                      wallet={w}
                      detected={false}
                      pending={pendingName === w.adapter.name && connecting}
                      onSelect={() => handlePick(w)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {detected.length === 0 && other.length === 0 && (
              <div className="rounded-md bg-surface-2 px-4 py-5 text-center font-(family-name:--font-dm-sans) text-[12.5px] font-medium text-text-muted">
                No wallets are available on this device.
              </div>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div className="mt-3 rounded-md bg-danger/10 border border-danger/25 px-3 py-2 font-(family-name:--font-dm-sans) text-[11.5px] font-semibold text-danger">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md font-(family-name:--font-dm-sans) text-[12px] font-medium cursor-pointer text-text-muted bg-surface-2"
            >
              <ArrowLeft size={12} strokeWidth={1.8} />
              Cancel
            </button>
            <p className="font-(family-name:--font-dm-sans) text-[10.5px] font-medium text-text-muted">
              New to Solana?{" "}
              <a
                href="https://solana.com/learn/wallets"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Learn more
              </a>
            </p>
          </div>
        </div>
      </MainCard>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <Title4 text={String(children)} />
    </div>
  );
}

function WalletRow({
  wallet,
  detected,
  pending,
  onSelect,
}: {
  wallet: Wallet;
  detected: boolean;
  pending: boolean;
  onSelect: () => void;
}) {
  const name = wallet.adapter.name;
  const icon = wallet.adapter.icon;
  const installable = wallet.readyState === WalletReadyState.NotDetected;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={pending}
        className={`group flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors cursor-pointer ${
          detected
            ? "bg-surface-2 border-border-base hover:border-accent/40"
            : "bg-transparent border-border-base/60 hover:bg-surface-2/60"
        } ${pending ? "opacity-70 cursor-wait" : ""}`}
      >
        <WalletAvatar icon={icon} name={name} dim={!detected && installable} />
        <div className="flex-1 min-w-0">
          <div className="font-(family-name:--font-dm-sans) text-[12.5px] font-semibold text-text-base truncate">
            {name}
          </div>
          <div className="font-(family-name:--font-dm-sans) text-[10.5px] font-medium text-text-muted truncate">
            {detected
              ? "Installed extension"
              : installable
              ? "Not installed — tap to get it"
              : "Available"}
          </div>
        </div>

        {pending ? (
          <Loader2
            size={14}
            strokeWidth={2}
            className="text-text-muted animate-spin shrink-0"
          />
        ) : detected ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/12 border border-accent/25 font-(family-name:--font-dm-sans) text-[9px] font-bold uppercase tracking-[0.06em] text-accent shrink-0">
            <Check size={9} strokeWidth={2.6} />
            Detected
          </span>
        ) : installable ? (
          <ExternalLink
            size={12}
            strokeWidth={2}
            className="text-text-muted group-hover:text-text-sec shrink-0"
          />
        ) : (
          <span className="font-(family-name:--font-dm-sans) text-[9.5px] font-bold uppercase tracking-[0.06em] text-text-muted shrink-0">
            Connect
          </span>
        )}
      </button>
    </li>
  );
}

function WalletAvatar({
  icon,
  name,
  dim,
}: {
  icon: string;
  name: string;
  dim: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-center w-7 h-7 rounded-md bg-surface-2 border border-border-base shrink-0 overflow-hidden ${
        dim ? "opacity-70" : ""
      }`}
    >
      {/* Wallet adapter icons are usually inline SVG data URIs — render with an img. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={icon}
        alt={`${name} logo`}
        className="w-5 h-5 object-contain"
        loading="lazy"
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function splitWallets(wallets: readonly Wallet[]): {
  detected: Wallet[];
  other: Wallet[];
} {
  const detected: Wallet[] = [];
  const other: Wallet[] = [];
  for (const w of wallets) {
    if (w.readyState === WalletReadyState.Installed) {
      detected.push(w);
    } else {
      other.push(w);
    }
  }
  detected.sort((a, b) => a.adapter.name.localeCompare(b.adapter.name));
  other.sort((a, b) => {
    const rank = (w: Wallet) =>
      w.readyState === WalletReadyState.Loadable ? 0 : 1;
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.adapter.name.localeCompare(b.adapter.name);
  });
  return { detected, other };
}
