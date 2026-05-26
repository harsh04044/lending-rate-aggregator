/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { fetchJupiterMarket } from "@/app/utils/juplend";
import { findDriftMarketPair } from "@/app/utils/drift";
import { findSaveMarketPair } from "@/app/utils/save";
import { findKaminoMarketPair } from "@/app/utils/kamino";
import { getTokenInfo } from "@/app/lib/token-registry";
import { Protocol } from "@/app/types/main";

interface MarketOption {
  protocol: Protocol;
  available: boolean;
  reason?: string; // only when available = false
  supplyApy?: number;
  borrowApy?: number;
  netApy?: number;
  ltv?: number;
  liquidationThreshold?: number;
  meta?: Record<string, any>; // protocol-specific data for tx building
}

interface MarketComparisonResponse {
  collateralMint: string;
  collateralSymbol: string;
  debtMint?: string;
  debtSymbol?: string;
  markets: MarketOption[];
}

// TODO: we'll add scores (considering everything, audits, tvl of the protocol, supplyApy, borrow rate, etc) later,
// now we just have 3 filters: highest ltv, best borrow rate, highest yield

export async function GET(
  request: Request,
  { params }: { params: Promise<{ "collateral-mint": string }> },
) {
  const { "collateral-mint": collateralMint } = await params;
  const { searchParams } = new URL(request.url);
  const debtMint = searchParams.get("debtMint") ?? undefined;

  if (!collateralMint) {
    return NextResponse.json(
      { error: "Missing collateral-mint" },
      { status: 400 },
    );
  }

  // Resolve token symbols
  const [collateralInfo, debtInfo] = await Promise.all([
    getTokenInfo(collateralMint),
    debtMint ? getTokenInfo(debtMint) : Promise.resolve(null),
  ]);

  const collateralSymbol = collateralInfo?.symbol ?? collateralMint.slice(0, 6);
  const debtSymbol = debtMint
    ? (debtInfo?.symbol ?? debtMint.slice(0, 6))
    : undefined;

  // Query all 4 protocols in parallel
  const [jupResult, driftResult, saveResult, kaminoResult] =
    await Promise.allSettled([
      fetchJupiterMarket(collateralMint, debtMint),
      findDriftMarketPair(collateralMint, debtMint),
      findSaveMarketPair(collateralMint, debtMint),
      findKaminoMarketPair(collateralMint, debtMint),
    ]);

  const markets: MarketOption[] = [];

  // JupLend
  if (jupResult.status === "fulfilled" && jupResult.value) {
    const s = jupResult.value.stats;
    const supplyApy = parseFloat(s.supplyApy);
    const borrowApy = s.borrowApy ? parseFloat(s.borrowApy) : undefined;

    markets.push({
      protocol: Protocol.JupLend,
      available: true,
      supplyApy,
      borrowApy,
      netApy: borrowApy !== undefined ? supplyApy - borrowApy : undefined,
      // JupLend fetcher returns fraction (0.7 = 70%). Normalize to percent.
      ltv: s.ltv != null ? s.ltv * 100 : undefined,
      liquidationThreshold:
        s.liquidationThreshold != null ? s.liquidationThreshold * 100 : undefined,
      meta: {
        vaultId: jupResult.value.vaultId,
        vaultAddress: jupResult.value.vaultAddress,
      },
    });
  } else {
    markets.push({
      protocol: Protocol.JupLend,
      available: false,
      reason:
        jupResult.status === "rejected" ? "Failed to fetch" : "No market pair",
    });
  }

  // Drift
  if (driftResult.status === "fulfilled" && driftResult.value) {
    const s = driftResult.value.stats;
    const supplyApy = parseFloat(s.supplyApy);
    const borrowApy = s.borrowApy ? parseFloat(s.borrowApy) : undefined;

    markets.push({
      protocol: Protocol.Drift,
      available: true,
      supplyApy,
      borrowApy,
      netApy: borrowApy !== undefined ? supplyApy - borrowApy : undefined,
      // Drift fetcher returns fraction (initialAssetWeight / MARGIN_PRECISION).
      ltv: s.ltv != null ? s.ltv * 100 : undefined,
      liquidationThreshold:
        s.liquidationThreshold != null ? s.liquidationThreshold * 100 : undefined,
      meta: {
        collateralMarketIndex: driftResult.value.collateralMarketIndex,
        debtMarketIndex: driftResult.value.debtMarketIndex,
        poolId: driftResult.value.poolId,
      },
    });
  } else {
    markets.push({
      protocol: Protocol.Drift,
      available: false,
      reason:
        driftResult.status === "rejected"
          ? "Failed to fetch"
          : "No market pair",
    });
  }

  // Save
  if (saveResult.status === "fulfilled" && saveResult.value) {
    const s = saveResult.value.stats;
    const supplyApy = parseFloat(s.supplyApy);
    const borrowApy = s.borrowApy ? parseFloat(s.borrowApy) : undefined;

    // Project Save reserve configs to the lean descriptor shape the frontend
    // tx-builder consumes. Strips logo/symbol/name to keep payload tight.
    const toDescriptor = (r: {
      address: string;
      liquidityToken: { mint: string; decimals: number };
      liquidityAddress: string;
      collateralMintAddress: string;
      collateralSupplyAddress: string;
      liquidityFeeReceiverAddress: string;
      pythOracle: string;
      switchboardOracle: string;
    }) => ({
      address: r.address,
      mint: r.liquidityToken.mint,
      decimals: r.liquidityToken.decimals,
      liquidityAddress: r.liquidityAddress,
      collateralMintAddress: r.collateralMintAddress,
      collateralSupplyAddress: r.collateralSupplyAddress,
      liquidityFeeReceiverAddress: r.liquidityFeeReceiverAddress,
      pythOracle: r.pythOracle,
      switchboardOracle: r.switchboardOracle,
    });

    markets.push({
      protocol: Protocol.Save,
      available: true,
      supplyApy,
      borrowApy,
      netApy: borrowApy !== undefined ? supplyApy - borrowApy : undefined,
      // Save fetcher returns fraction (loanToValueRatio / liquidationThreshold).
      ltv: s.ltv != null ? s.ltv * 100 : undefined,
      liquidationThreshold:
        s.liquidationThreshold != null ? s.liquidationThreshold * 100 : undefined,
      meta: {
        poolAddress: saveResult.value.poolAddress,
        poolName: saveResult.value.poolName,
        authorityAddress: saveResult.value.authorityAddress,
        lookupTableAddress: saveResult.value.lookupTableAddress,
        collateralReserve: toDescriptor(saveResult.value.collateralReserve),
        debtReserve: saveResult.value.debtReserve
          ? toDescriptor(saveResult.value.debtReserve)
          : null,
        allReserves: saveResult.value.allReserves.map(toDescriptor),
      },
    });
  } else {
    markets.push({
      protocol: Protocol.Save,
      available: false,
      reason:
        saveResult.status === "rejected" ? "Failed to fetch" : "No market pair",
    });
  }

  // Kamino
  if (kaminoResult.status === "fulfilled" && kaminoResult.value) {
    const s = kaminoResult.value.stats;
    const supplyApy = parseFloat(s.supplyApy);
    const borrowApy = s.borrowApy ? parseFloat(s.borrowApy) : undefined;

    markets.push({
      protocol: Protocol.Kamino,
      available: true,
      supplyApy,
      borrowApy,
      netApy: borrowApy !== undefined ? supplyApy - borrowApy : undefined,
      // Kamino fetcher returns fraction (loanToValue / liquidationThreshold).
      ltv: s.ltv != null ? s.ltv * 100 : undefined,
      liquidationThreshold:
        s.liquidationThreshold != null ? s.liquidationThreshold * 100 : undefined,
      meta: {
        marketAddress: kaminoResult.value.marketAddress,
        collateralReserveAddress:
          kaminoResult.value.collateralReserveAddress.toString(),
        debtReserveAddress: kaminoResult.value.debtReserveAddress,
      },
    });
  } else {
    markets.push({
      protocol: Protocol.Kamino,
      available: false,
      reason:
        kaminoResult.status === "rejected"
          ? "Failed to fetch"
          : "No market pair",
    });
  }

  const response: MarketComparisonResponse = {
    collateralMint,
    collateralSymbol,
    debtMint,
    debtSymbol,
    markets,
  };

  return NextResponse.json(response);
}
