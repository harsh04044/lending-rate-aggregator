"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import {
  CoinbaseWalletAdapter,
  LedgerWalletAdapter,
  TrezorWalletAdapter,
  TrustWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import type { Adapter } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";

// Modern wallets (Phantom, Solflare, Backpack, Glow, Brave, Coin98, Exodus,
// MathWallet, NuFi, etc.) self-register through the Wallet Standard, so the
// provider auto-detects them. We only need to register adapters for wallets
// that don't broadcast via Wallet Standard. WalletConnect is intentionally
// omitted — it pulls in @reown/appkit + viem (~MB and noisy webpack warnings
// from ox/tempo). Add it later by pnpm-installing
// `@solana/wallet-adapter-walletconnect` and dynamically importing it here.
function buildLegacyAdapters(): Adapter[] {
  return [
    new LedgerWalletAdapter(),
    new TrezorWalletAdapter(),
    new CoinbaseWalletAdapter(),
    new TrustWalletAdapter(),
  ];
}

export function WalletProviders({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl("mainnet-beta"),
    [],
  );
  const wallets = useMemo(() => buildLegacyAdapters(), []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
