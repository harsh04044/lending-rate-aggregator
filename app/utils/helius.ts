// app/utils/helius.ts

const HELIUS_API_BASE = "https://api.helius.xyz/v0";
const HELIUS_API_URL = `${HELIUS_API_BASE}/addresses`;

interface HeliusTokenTransfer {
  fromTokenAccount: string;
  toTokenAccount: string;
  fromUserAccount: string;
  toUserAccount: string;
  tokenAmount: number;
  mint: string;
  tokenStandard: string;
}

interface HeliusInstruction {
  programId: string;
  data: string; // base58 encoded
  accounts: string[];
  innerInstructions?: HeliusInstruction[];
}

export interface HeliusTransaction {
  signature: string;
  timestamp: number;
  type: string;
  source: string;
  description: string;
  tokenTransfers: HeliusTokenTransfer[];
  instructions: HeliusInstruction[];
}

export async function fetchHeliusTransactions(
  accountAddress: string,
  options?: {
    before?: string; // tx signature for pagination
    limit?: number;
    programId?: string; // client-side filter: only return txs containing this program
  },
): Promise<HeliusTransaction[]> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error("HELIUS_API_KEY not configured");

  // When filtering by programId, fetch the max (100) to maximise matches
  const limit = options?.programId ? 100 : (options?.limit ?? 20);

  let url = `${HELIUS_API_URL}/${accountAddress}/transactions?api-key=${apiKey}&limit=${limit}`;

  if (options?.before) {
    url += `&before=${options.before}`;
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Helius API error: ${response.status}`);
  }

  const txs: HeliusTransaction[] = await response.json();

  if (!options?.programId) return txs;

  const programId = options.programId;
  return txs.filter((tx) =>
    tx.instructions.some(
      (ix) =>
        ix.programId === programId ||
        ix.innerInstructions?.some((inner) => inner.programId === programId),
    ),
  );
}

// Batch-parse arbitrary signatures via POST /v0/transactions.
// Helius caps the request at 100 signatures per call.
const HELIUS_PARSE_BATCH_LIMIT = 100;

export async function parseHeliusTransactions(
  signatures: string[],
): Promise<HeliusTransaction[]> {
  if (signatures.length === 0) return [];

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error("HELIUS_API_KEY not configured");

  // Chunk into batches of 100 and run in parallel
  const batches: string[][] = [];
  for (let i = 0; i < signatures.length; i += HELIUS_PARSE_BATCH_LIMIT) {
    batches.push(signatures.slice(i, i + HELIUS_PARSE_BATCH_LIMIT));
  }

  const url = `${HELIUS_API_BASE}/transactions?api-key=${apiKey}`;

  const results = await Promise.all(
    batches.map(async (batch) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions: batch }),
      });

      if (!response.ok) {
        throw new Error(`Helius parse API error: ${response.status}`);
      }

      return response.json() as Promise<HeliusTransaction[]>;
    }),
  );

  return results.flat();
}
