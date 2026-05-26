import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { Protocol, NormalizedPosition } from "@/app/types/main";
import {
  HistoryEntry,
  HistoryResponse,
  TokenDetail,
  JUPLEND_VAULTS_PROGRAM,
} from "@/app/lib/discriminators";
import { fetchHeliusTransactions } from "@/app/utils/helius";
import {
  getPositionsByProtocol,
  setPositionsByProtocol,
} from "@/app/utils/cache";
import {
  fetchJupLendPositions,
  getVaultPairs,
  processJupLendTransaction,
} from "@/app/utils/juplend";
import {
  fetchDriftPositions,
  processDriftTransaction,
} from "@/app/utils/drift";
import { fetchSavePositions, processSaveTransaction } from "@/app/utils/save";
import {
  fetchKaminoPositions,
  processKaminoTransaction,
} from "@/app/utils/kamino";

const VALID_PROTOCOLS: Protocol[] = [
  Protocol.JupLend,
  Protocol.Drift,
  Protocol.Save,
  Protocol.Kamino,
];

const PROTOCOL_FETCHERS: Record<
  Protocol,
  (wallet: string) => Promise<NormalizedPosition[]>
> = {
  JupLend: fetchJupLendPositions,
  Drift: fetchDriftPositions,
  Save: fetchSavePositions,
  Kamino: fetchKaminoPositions,
};

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ protocol: string }> },
) {
  const { protocol } = await params;
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");

  if (!wallet) {
    return NextResponse.json(
      { error: "Missing wallet query param" },
      { status: 400 },
    );
  }

  try {
    new PublicKey(wallet);
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet address" },
      { status: 400 },
    );
  }

  if (!VALID_PROTOCOLS.includes(protocol as Protocol)) {
    return NextResponse.json(
      {
        error: `Invalid protocol. Must be one of: ${VALID_PROTOCOLS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const protocolName = protocol as Protocol;
  const noCache = searchParams.get("noCache") === "1";

  // Positions used for empty-state check and Kamino obligation-based fetching
  let positions = noCache
    ? null
    : getPositionsByProtocol(wallet, protocolName);

  if (!positions) {
    const fetcher = PROTOCOL_FETCHERS[protocolName];
    const fetched = await fetcher(wallet);
    setPositionsByProtocol(wallet, protocolName, fetched);
    positions = fetched;
  }

  const allEntries: HistoryEntry[] = [];

  if (protocolName === Protocol.JupLend) {
    const [allTxs, vaultPairs] = await Promise.all([
      fetchHeliusTransactions(wallet, { programId: JUPLEND_VAULTS_PROGRAM }),
      getVaultPairs(),
    ]);

    for (const tx of allTxs) {
      const entries = await processJupLendTransaction(tx, vaultPairs, wallet);
      allEntries.push(...entries);
    }
  } else if (protocolName === Protocol.Save) {
    if (positions.length === 0) {
      return NextResponse.json({ wallet, protocol: protocolName, entries: [] });
    }

    const txGroups = await Promise.all(
      positions.map((pos) =>
        fetchHeliusTransactions(pos.accountAddress, { limit: 50 }),
      ),
    );
    const obligationTxs = txGroups.flat();

    const seen = new Set<string>();
    const uniqueTxs = obligationTxs.filter((tx) => {
      if (seen.has(tx.signature)) return false;
      seen.add(tx.signature);
      return true;
    });

    for (const tx of uniqueTxs) {
      const entries = await processSaveTransaction(tx, wallet);
      allEntries.push(...entries);
    }
  } else if (protocolName === Protocol.Kamino) {
    // Obligation-based fetching — each Kamino obligation only has Kamino txs.
    // Closed/liquidated positions won't appear (no accountAddress to query).
    if (positions.length === 0) {
      return NextResponse.json({
        wallet,
        protocol: protocolName,
        entries: [],
      });
    }

    const txGroups = await Promise.all(
      positions.map((pos) =>
        fetchHeliusTransactions(pos.accountAddress, { limit: 25 }),
      ),
    );
    const obligationTxs = txGroups.flat();

    // Deduplicate (same tx can appear across obligations)
    const seen = new Set<string>();
    const uniqueTxs = obligationTxs.filter((tx) => {
      if (seen.has(tx.signature)) return false;
      seen.add(tx.signature);
      return true;
    });

    for (const tx of uniqueTxs) {
      const entries = await processKaminoTransaction(tx, wallet);
      allEntries.push(...entries);
    }
  } else if (protocolName === Protocol.Drift) {
    // Obligation-based fetching via Drift user account PDA.
    // Drift user accounts only contain Drift txs, so no filtering needed.
    if (positions.length === 0) {
      return NextResponse.json({
        wallet,
        protocol: protocolName,
        entries: [],
      });
    }

    // Build mint sets from current position state for classification
    const debtMints = new Set<string>();
    const collateralMints = new Set<string>();
    for (const pos of positions) {
      for (const asset of pos.debt) debtMints.add(asset.mint);
      for (const asset of pos.collateral) collateralMints.add(asset.mint);
    }

    const txGroups = await Promise.all(
      positions.map((pos) =>
        fetchHeliusTransactions(pos.accountAddress, { limit: 25 }),
      ),
    );
    const userAccountTxs = txGroups.flat();

    // Deduplicate
    const seen = new Set<string>();
    const uniqueTxs = userAccountTxs.filter((tx) => {
      if (seen.has(tx.signature)) return false;
      seen.add(tx.signature);
      return true;
    });

    for (const tx of uniqueTxs) {
      const entries = await processDriftTransaction(
        tx,
        wallet,
        debtMints,
        collateralMints,
      );
      allEntries.push(...entries);
    }
  }

  // Collapse multi-action transactions into a single "refinance" entry.
  // A refinance tx has mixed action types (e.g. deposit + borrow, repay + withdraw).
  const entriesBySignature = new Map<string, HistoryEntry[]>();
  for (const entry of allEntries) {
    const group = entriesBySignature.get(entry.signature) ?? [];
    group.push(entry);
    entriesBySignature.set(entry.signature, group);
  }

  const processedEntries: HistoryEntry[] = [];
  for (const [, group] of entriesBySignature) {
    if (group.length === 1) {
      processedEntries.push(group[0]);
      continue;
    }

    const actionTypes = new Set(group.map((e) => e.actionType));
    const isRefinance =
      (actionTypes.has("deposit") || actionTypes.has("withdraw")) &&
      (actionTypes.has("borrow") || actionTypes.has("repay"));

    if (!isRefinance) {
      processedEntries.push(...group);
      continue;
    }

    // Collect tokens: deposit/withdraw first, then borrow/repay — deduplicated by mint
    const collateralEntries = group.filter(
      (e) => e.actionType === "deposit" || e.actionType === "withdraw",
    );
    const debtEntries = group.filter(
      (e) => e.actionType === "borrow" || e.actionType === "repay",
    );
    const seenMints = new Set<string>();
    const allTokens: TokenDetail[] = [];
    for (const entry of [...collateralEntries, ...debtEntries]) {
      for (const token of entry.tokens) {
        if (!seenMints.has(token.tokenMint)) {
          seenMints.add(token.tokenMint);
          allTokens.push(token);
        }
      }
    }

    const base = group[0];
    processedEntries.push({
      timestamp: base.timestamp,
      actionType: "refinance",
      tokens: allTokens,
      signature: base.signature,
      accountAddress: base.accountAddress,
    });
  }

  // Sort by timestamp descending
  processedEntries.sort((a, b) => b.timestamp - a.timestamp);

  const response: HistoryResponse = {
    wallet,
    protocol: protocolName,
    entries: processedEntries,
  };

  return NextResponse.json(response);
}
