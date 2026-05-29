"use client";

import {
  type Connection,
  type PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";

import { Protocol } from "@/app/types/main";
import type { JuplendPairPosition } from "@/app/(dashboard)/protocols/[slug]/page";
import type { RefinanceMigrateArgs } from "@/app/(dashboard)/optimize/_components/refinance-modal";

import { toRawAmount } from "@/src/lib/tx/amount";
import {
  pickJupLendPositionId,
  prepareJupLendToKaminoRefinance,
  prepareJupLendToSaveRefinance,
  prepareKaminoToJupLendRefinance,
  prepareKaminoToSaveRefinance,
  prepareSaveToJupLendRefinance,
  prepareSaveToKaminoRefinance,
  type JupLendPositionLite,
} from "@/src/lib/tx/refinance";
import { sendV0Tx, type SentTx } from "@/src/lib/tx/send";
import type { SaveReserveDescriptor } from "@/src/lib/tx/save";

export interface FromPositionContext {
  collateralMint: string;
  collateralDecimals: number;
  collateralSymbol?: string;
  debtMint: string;
  debtDecimals: number;
  debtSymbol?: string;
  meta?: Record<string, unknown>;
}

export interface BuildMigrateHandlerParams {
  fromProtocol: Protocol;
  toProtocol: Protocol;
  pair: JuplendPairPosition | undefined;
  fromCtx?: FromPositionContext;
  toMarketMeta: Record<string, unknown> | undefined;
  userJupLendPositions?: JupLendPositionLite[];
  // JupLend vault id for the *source* pair, used purely to borrow the
  // vault's LUT when JupLend isn't a direct participant in the tx but the
  // flow uses JupLend flash loans (e.g. Kamino → Save). Optional.
  auxJupLendVaultId?: number;
  walletPublicKey: PublicKey | null;
  signTransaction:
    | (<T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>)
    | undefined;
  connection: Connection;
}

export type MigrateHandler = (args: RefinanceMigrateArgs) => Promise<SentTx>;

export function buildMigrateHandler({
  fromProtocol,
  toProtocol,
  pair,
  fromCtx,
  toMarketMeta,
  userJupLendPositions,
  auxJupLendVaultId,
  walletPublicKey,
  signTransaction,
  connection,
}: BuildMigrateHandlerParams): MigrateHandler | undefined {
  if (!walletPublicKey || !signTransaction) return undefined;

  if (fromProtocol === Protocol.JupLend && toProtocol === Protocol.Save) {
    return buildJupLendToSave({
      pair,
      toMarketMeta,
      walletPublicKey,
      signTransaction,
      connection,
    });
  }

  if (fromProtocol === Protocol.JupLend && toProtocol === Protocol.Kamino) {
    return buildJupLendToKamino({
      pair,
      toMarketMeta,
      walletPublicKey,
      signTransaction,
      connection,
    });
  }

  if (fromProtocol === Protocol.Save && toProtocol === Protocol.JupLend) {
    return buildSaveToJupLend({
      fromCtx,
      toMarketMeta,
      userJupLendPositions,
      walletPublicKey,
      signTransaction,
      connection,
    });
  }

  if (fromProtocol === Protocol.Kamino && toProtocol === Protocol.JupLend) {
    return buildKaminoToJupLend({
      fromCtx,
      toMarketMeta,
      userJupLendPositions,
      walletPublicKey,
      signTransaction,
      connection,
    });
  }

  if (fromProtocol === Protocol.Kamino && toProtocol === Protocol.Save) {
    return buildKaminoToSave({
      fromCtx,
      toMarketMeta,
      auxJupLendVaultId,
      walletPublicKey,
      signTransaction,
      connection,
    });
  }

  if (fromProtocol === Protocol.Save && toProtocol === Protocol.Kamino) {
    return buildSaveToKamino({
      fromCtx,
      toMarketMeta,
      auxJupLendVaultId,
      walletPublicKey,
      signTransaction,
      connection,
    });
  }

  return undefined;
}

function buildJupLendToSave({
  pair,
  toMarketMeta,
  walletPublicKey,
  signTransaction,
  connection,
}: {
  pair: JuplendPairPosition | undefined;
  toMarketMeta: Record<string, unknown> | undefined;
  walletPublicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  connection: Connection;
}): MigrateHandler | undefined {
  const jupMeta = pair?.meta as
    | { positionId?: number; vaultId?: number }
    | undefined;
  if (!pair || !jupMeta?.positionId || !jupMeta?.vaultId) return undefined;

  const saveMeta = toMarketMeta as
    | {
        poolAddress?: string;
        authorityAddress?: string;
        lookupTableAddress?: string;
        collateralReserve?: SaveReserveDescriptor;
        debtReserve?: SaveReserveDescriptor | null;
        allReserves?: SaveReserveDescriptor[];
      }
    | undefined;
  if (
    !saveMeta?.poolAddress ||
    !saveMeta?.authorityAddress ||
    !saveMeta?.collateralReserve ||
    !saveMeta?.allReserves
  ) {
    return undefined;
  }

  return async ({ colNum, debtNum, isMax }) => {
    const colAmountRaw = toRawAmount(String(colNum), pair.collateralDecimals);
    const debtAmountRaw =
      debtNum > 0 ? toRawAmount(String(debtNum), pair.debtDecimals) : new BN(0);

    const prepared = await prepareJupLendToSaveRefinance({
      jupLendVaultId: jupMeta.vaultId!,
      jupLendPositionId: jupMeta.positionId!,
      collateralMint: pair.collateralMint,
      debtMint: pair.debtMint,
      savePoolAddress: saveMeta.poolAddress!,
      saveAuthorityAddress: saveMeta.authorityAddress!,
      saveLookupTableAddress: saveMeta.lookupTableAddress,
      saveCollateralReserve: saveMeta.collateralReserve!,
      saveDebtReserve: saveMeta.debtReserve ?? undefined,
      saveAllReserves: saveMeta.allReserves!,
      collateralAmountRaw: colAmountRaw,
      debtAmountRaw,
      isMax,
      walletPublicKey,
      connection,
    });

    return sendV0Tx({
      connection,
      signer: { publicKey: walletPublicKey, signTransaction },
      instructions: prepared.instructions,
      lookupTables: prepared.lookupTables,
    });
  };
}

function buildJupLendToKamino({
  pair,
  toMarketMeta,
  walletPublicKey,
  signTransaction,
  connection,
}: {
  pair: JuplendPairPosition | undefined;
  toMarketMeta: Record<string, unknown> | undefined;
  walletPublicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  connection: Connection;
}): MigrateHandler | undefined {
  const jupMeta = pair?.meta as
    | { positionId?: number; vaultId?: number }
    | undefined;
  if (!pair || !jupMeta?.positionId || !jupMeta?.vaultId) return undefined;

  const kaminoMeta = toMarketMeta as { marketAddress?: string } | undefined;
  if (!kaminoMeta?.marketAddress) return undefined;

  return async ({ colNum, debtNum, isMax }) => {
    const colAmountRaw = toRawAmount(String(colNum), pair.collateralDecimals);
    const debtAmountRaw =
      debtNum > 0 ? toRawAmount(String(debtNum), pair.debtDecimals) : new BN(0);

    const prepared = await prepareJupLendToKaminoRefinance({
      jupLendVaultId: jupMeta.vaultId!,
      jupLendPositionId: jupMeta.positionId!,
      collateralMint: pair.collateralMint,
      debtMint: pair.debtMint,
      kaminoMarketAddress: kaminoMeta.marketAddress!,
      collateralAmountRaw: colAmountRaw,
      debtAmountRaw,
      isMax,
      walletPublicKey,
      connection,
    });

    return sendV0Tx({
      connection,
      signer: { publicKey: walletPublicKey, signTransaction },
      instructions: prepared.instructions,
      lookupTables: prepared.lookupTables,
    });
  };
}

function buildSaveToJupLend({
  fromCtx,
  toMarketMeta,
  userJupLendPositions,
  walletPublicKey,
  signTransaction,
  connection,
}: {
  fromCtx: FromPositionContext | undefined;
  toMarketMeta: Record<string, unknown> | undefined;
  userJupLendPositions: JupLendPositionLite[] | undefined;
  walletPublicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  connection: Connection;
}): MigrateHandler | undefined {
  if (!fromCtx) return undefined;

  const saveMeta = fromCtx.meta as
    | {
        poolAddress?: string;
        authorityAddress?: string;
        lookupTableAddress?: string;
        collateralReserve?: SaveReserveDescriptor;
        debtReserve?: SaveReserveDescriptor;
        allReserves?: SaveReserveDescriptor[];
      }
    | undefined;
  if (
    !saveMeta?.poolAddress ||
    !saveMeta?.authorityAddress ||
    !saveMeta?.collateralReserve ||
    !saveMeta?.debtReserve ||
    !saveMeta?.allReserves
  ) {
    return undefined;
  }

  const jupMeta = toMarketMeta as { vaultId?: number } | undefined;
  if (!jupMeta?.vaultId) return undefined;

  return async ({ colNum, debtNum, isMax, isDebtMax }) => {
    const colAmountRaw = toRawAmount(
      String(colNum),
      fromCtx.collateralDecimals,
    );
    const debtAmountRaw = toRawAmount(String(debtNum), fromCtx.debtDecimals);

    const positionId = pickJupLendPositionId(
      userJupLendPositions,
      jupMeta.vaultId!,
    );

    const prepared = await prepareSaveToJupLendRefinance({
      jupLendVaultId: jupMeta.vaultId!,
      jupLendPositionId: positionId,
      collateralMint: fromCtx.collateralMint,
      debtMint: fromCtx.debtMint,
      savePoolAddress: saveMeta.poolAddress!,
      saveAuthorityAddress: saveMeta.authorityAddress!,
      saveLookupTableAddress: saveMeta.lookupTableAddress,
      saveCollateralReserve: saveMeta.collateralReserve!,
      saveDebtReserve: saveMeta.debtReserve!,
      saveAllReserves: saveMeta.allReserves!,
      collateralAmountRaw: colAmountRaw,
      debtAmountRaw,
      isMax,
      isDebtMax,
      walletPublicKey,
      connection,
    });

    return sendV0Tx({
      connection,
      signer: { publicKey: walletPublicKey, signTransaction },
      instructions: prepared.instructions,
      lookupTables: prepared.lookupTables,
    });
  };
}

function buildKaminoToJupLend({
  fromCtx,
  toMarketMeta,
  userJupLendPositions,
  walletPublicKey,
  signTransaction,
  connection,
}: {
  fromCtx: FromPositionContext | undefined;
  toMarketMeta: Record<string, unknown> | undefined;
  userJupLendPositions: JupLendPositionLite[] | undefined;
  walletPublicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  connection: Connection;
}): MigrateHandler | undefined {
  if (!fromCtx) return undefined;

  const kaminoMeta = fromCtx.meta as { marketAddress?: string } | undefined;
  if (!kaminoMeta?.marketAddress) return undefined;

  const jupMeta = toMarketMeta as { vaultId?: number } | undefined;
  if (!jupMeta?.vaultId) return undefined;

  return async ({ colNum, debtNum, isMax }) => {
    const colAmountRaw = toRawAmount(
      String(colNum),
      fromCtx.collateralDecimals,
    );
    const debtAmountRaw = toRawAmount(String(debtNum), fromCtx.debtDecimals);

    const positionId = pickJupLendPositionId(
      userJupLendPositions,
      jupMeta.vaultId!,
    );

    const prepared = await prepareKaminoToJupLendRefinance({
      jupLendVaultId: jupMeta.vaultId!,
      jupLendPositionId: positionId,
      collateralMint: fromCtx.collateralMint,
      debtMint: fromCtx.debtMint,
      kaminoMarketAddress: kaminoMeta.marketAddress!,
      collateralAmountRaw: colAmountRaw,
      debtAmountRaw,
      isMax,
      walletPublicKey,
      connection,
    });

    return sendV0Tx({
      connection,
      signer: { publicKey: walletPublicKey, signTransaction },
      instructions: prepared.instructions,
      lookupTables: prepared.lookupTables,
    });
  };
}

function buildKaminoToSave({
  fromCtx,
  toMarketMeta,
  auxJupLendVaultId,
  walletPublicKey,
  signTransaction,
  connection,
}: {
  fromCtx: FromPositionContext | undefined;
  toMarketMeta: Record<string, unknown> | undefined;
  auxJupLendVaultId: number | undefined;
  walletPublicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  connection: Connection;
}): MigrateHandler | undefined {
  if (!fromCtx) return undefined;

  const kaminoMeta = fromCtx.meta as { marketAddress?: string } | undefined;
  if (!kaminoMeta?.marketAddress) return undefined;

  const saveMeta = toMarketMeta as
    | {
        poolAddress?: string;
        authorityAddress?: string;
        lookupTableAddress?: string;
        collateralReserve?: SaveReserveDescriptor;
        debtReserve?: SaveReserveDescriptor | null;
        allReserves?: SaveReserveDescriptor[];
      }
    | undefined;
  if (
    !saveMeta?.poolAddress ||
    !saveMeta?.authorityAddress ||
    !saveMeta?.collateralReserve ||
    !saveMeta?.debtReserve ||
    !saveMeta?.allReserves
  ) {
    return undefined;
  }

  return async ({ colNum, debtNum, isMax }) => {
    const colAmountRaw = toRawAmount(
      String(colNum),
      fromCtx.collateralDecimals,
    );
    const debtAmountRaw = toRawAmount(String(debtNum), fromCtx.debtDecimals);

    const prepared = await prepareKaminoToSaveRefinance({
      kaminoMarketAddress: kaminoMeta.marketAddress!,
      collateralMint: fromCtx.collateralMint,
      debtMint: fromCtx.debtMint,
      savePoolAddress: saveMeta.poolAddress!,
      saveAuthorityAddress: saveMeta.authorityAddress!,
      saveLookupTableAddress: saveMeta.lookupTableAddress,
      saveCollateralReserve: saveMeta.collateralReserve!,
      saveDebtReserve: saveMeta.debtReserve!,
      saveAllReserves: saveMeta.allReserves!,
      auxJupLendVaultId,
      collateralAmountRaw: colAmountRaw,
      debtAmountRaw,
      isMax,
      walletPublicKey,
      connection,
    });

    return sendV0Tx({
      connection,
      signer: { publicKey: walletPublicKey, signTransaction },
      instructions: prepared.instructions,
      lookupTables: prepared.lookupTables,
    });
  };
}

function buildSaveToKamino({
  fromCtx,
  toMarketMeta,
  auxJupLendVaultId,
  walletPublicKey,
  signTransaction,
  connection,
}: {
  fromCtx: FromPositionContext | undefined;
  toMarketMeta: Record<string, unknown> | undefined;
  auxJupLendVaultId: number | undefined;
  walletPublicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  connection: Connection;
}): MigrateHandler | undefined {
  if (!fromCtx) return undefined;

  const saveMeta = fromCtx.meta as
    | {
        poolAddress?: string;
        authorityAddress?: string;
        lookupTableAddress?: string;
        collateralReserve?: SaveReserveDescriptor;
        debtReserve?: SaveReserveDescriptor;
        allReserves?: SaveReserveDescriptor[];
      }
    | undefined;
  if (
    !saveMeta?.poolAddress ||
    !saveMeta?.authorityAddress ||
    !saveMeta?.collateralReserve ||
    !saveMeta?.debtReserve ||
    !saveMeta?.allReserves
  ) {
    return undefined;
  }

  const kaminoMeta = toMarketMeta as { marketAddress?: string } | undefined;
  if (!kaminoMeta?.marketAddress) return undefined;

  return async ({ colNum, debtNum, isMax, isDebtMax }) => {
    const colAmountRaw = toRawAmount(
      String(colNum),
      fromCtx.collateralDecimals,
    );
    const debtAmountRaw = toRawAmount(String(debtNum), fromCtx.debtDecimals);

    const prepared = await prepareSaveToKaminoRefinance({
      savePoolAddress: saveMeta.poolAddress!,
      saveAuthorityAddress: saveMeta.authorityAddress!,
      saveLookupTableAddress: saveMeta.lookupTableAddress,
      saveCollateralReserve: saveMeta.collateralReserve!,
      saveDebtReserve: saveMeta.debtReserve!,
      saveAllReserves: saveMeta.allReserves!,
      kaminoMarketAddress: kaminoMeta.marketAddress!,
      collateralMint: fromCtx.collateralMint,
      debtMint: fromCtx.debtMint,
      auxJupLendVaultId,
      collateralAmountRaw: colAmountRaw,
      debtAmountRaw,
      isMax,
      isDebtMax,
      walletPublicKey,
      connection,
    });

    return sendV0Tx({
      connection,
      signer: { publicKey: walletPublicKey, signTransaction },
      instructions: prepared.instructions,
      lookupTables: prepared.lookupTables,
    });
  };
}
