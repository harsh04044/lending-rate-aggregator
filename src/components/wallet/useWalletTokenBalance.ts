"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";

const SOL_MINT = "So11111111111111111111111111111111111111112";

const SOL_FEE_RESERVE_LAMPORTS = 10_000_000; // 0.01 SOL

export interface WalletTokenBalance {
  balance: number | null;
  loading: boolean;
}

export function useWalletTokenBalance(
  mint: string | null | undefined,
  decimals: number | null | undefined,
): WalletTokenBalance {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey || !mint || decimals == null) {
      setBalance(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        if (mint === SOL_MINT) {
          const lamports = await connection.getBalance(publicKey);
          const spendable = Math.max(0, lamports - SOL_FEE_RESERVE_LAMPORTS);
          if (!cancelled) setBalance(spendable / 10 ** decimals);
          return;
        }

        const ata = getAssociatedTokenAddressSync(
          new PublicKey(mint),
          publicKey,
        );
        const account = await getAccount(connection, ata).catch(() => null);
        const raw = account ? Number(account.amount.toString()) : 0;
        if (!cancelled) setBalance(raw / 10 ** decimals);
      } catch {
        if (!cancelled) setBalance(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, mint, decimals]);

  return { balance, loading };
}
