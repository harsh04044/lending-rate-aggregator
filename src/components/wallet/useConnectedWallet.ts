"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

export interface ConnectedWalletInfo {
  address: string | null;
  isConnected: boolean;
  isInitializing: boolean;
  publicKey: string | null;
}

const STORED_WALLET_KEY = "walletName";

export function useConnectedWallet(): ConnectedWalletInfo {
  const { publicKey, connected, connecting, disconnecting, wallet } =
    useWallet();

  // On SSR / first client render, useEffect hasn't run yet — treat that
  // window as "still initializing" so the UI doesn't flash a connect gate
  // before the adapter has had a chance to read localStorage.
  const [hydrated, setHydrated] = useState(false);
  const [hasStoredWallet, setHasStoredWallet] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORED_WALLET_KEY);
      // Adapter stores JSON; an unset / cleared value is `null` or the
      // string `"null"`. Treat anything else as "user previously had a
      // wallet, expect auto-connect to fire."
      setHasStoredWallet(raw != null && raw !== "null" && raw !== '""');
    } catch {
      setHasStoredWallet(false);
    }
    setHydrated(true);
  }, []);

  const pubkey = publicKey?.toBase58() ?? null;

  const isInitializing =
    !hydrated ||
    connecting ||
    disconnecting ||
    (Boolean(wallet) && !connected) ||
    (hasStoredWallet && !connected && !wallet);

  return {
    address: pubkey,
    isConnected: connected,
    isInitializing,
    publicKey: pubkey,
  };
}
