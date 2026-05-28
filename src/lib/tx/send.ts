"use client";

import {
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";

// Subset of useWallet() we need for client-side signing.
export interface WalletSigner {
  publicKey: PublicKey | null;
  signTransaction:
    | (<T extends VersionedTransaction>(tx: T) => Promise<T>)
    | undefined;
}

export interface SentTx {
  // Tx signature returned by sendRawTransaction. The cluster has accepted the tx but it may not yet be confirmed.
  // Use confirm to await the on-chain commitment.
  signature: string;
  // Resolves once the cluster reaches "confirmed" commitment for this signature.
  // Rejects if the on-chain execution failed.
  confirm: Promise<void>;
}

// Builds, signs, and sends a v0 tx, but does NOT await confirmation.
// Returns the signature plus a confirm promise the caller can await
// (or run in the background) once the modal has closed. Splits user-
// visible "tx sent" feedback (~1s) from on-chain confirmation (5-15s)
// so the submit spinner doesn't sit there during the slow wait.
export async function sendV0Tx({
  connection,
  signer,
  instructions,
  lookupTables,
}: {
  connection: Connection;
  signer: WalletSigner;
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}): Promise<SentTx> {
  if (!signer.publicKey || !signer.signTransaction) {
    throw new Error("Wallet is not connected.");
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  const tx = new VersionedTransaction(message);
  const signed = await signer.signTransaction(tx);

  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  const confirm = confirmSignature({
    connection,
    signature,
    blockhash,
    lastValidBlockHeight,
  });

  return { signature, confirm };
}

// Hybrid confirmation: race the WS-based confirmTransaction against an HTTP
// polling loop on getSignatureStatuses. WS resolves first on healthy RPCs;
// polling is the authoritative fallback when the WS notification is missed
function confirmSignature({
  connection,
  signature,
  blockhash,
  lastValidBlockHeight,
}: {
  connection: Connection;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}): Promise<void> {
  const HARD_TIMEOUT_MS = 90_000;
  const POLL_INTERVALS_MS = [1000, 1000, 2000];

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    // WS leg. May resolve fast on a healthy RPC, may also hang or reject due
    // to WS issues, failures here are swallowed so polling can decide.
    connection
      .confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      )
      .then((c) => {
        if (c.value.err) {
          settle(
            new Error(`Transaction failed: ${JSON.stringify(c.value.err)}`),
          );
        } else {
          settle();
        }
      })
      .catch(() => {
        // Silent, the polling leg is the source of truth.
      });

    // Polling leg.
    void (async () => {
      const start = Date.now();
      let i = 0;
      while (!settled && Date.now() - start < HARD_TIMEOUT_MS) {
        const wait =
          POLL_INTERVALS_MS[Math.min(i, POLL_INTERVALS_MS.length - 1)];
        await new Promise((r) => setTimeout(r, wait));
        i++;
        if (settled) return;

        try {
          const { value } = await connection.getSignatureStatuses([signature]);
          const status = value[0];
          if (status?.err) {
            settle(
              new Error(`Transaction failed: ${JSON.stringify(status.err)}`),
            );
            return;
          }
          if (
            status?.confirmationStatus === "confirmed" ||
            status?.confirmationStatus === "finalized"
          ) {
            settle();
            return;
          }
        } catch {
          // Useless RPC error, keep polling.
        }
      }
      settle(new Error("Transaction confirmation timed out."));
    })();
  });
}

// Backwards-compatible wrapper: builds, sends, and awaits confirmation.
// Used by callers that legitimately need to wait (rare) or by a single
// shot path that doesn't care about UX latency.
export async function buildAndSendV0Tx(args: {
  connection: Connection;
  signer: WalletSigner;
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
}): Promise<string> {
  const { signature, confirm } = await sendV0Tx(args);
  await confirm;
  return signature;
}
