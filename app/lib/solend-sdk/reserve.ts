import { type AccountInfo, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import BN from "bn.js";
import { Buffer } from "buffer";
import * as Layout from "./buffer-layout";

import BufferLayout from "buffer-layout";
import { LastUpdateLayout, type LastUpdate } from "./lastUpdate";
import { parseRateLimiter, RateLimiterLayout, type RateLimiter } from "./rateLimiter";
import { U64_MAX } from "./constants";
import { calculateBorrowInterest, calculateSupplyInterest } from "./rates";

export interface Reserve {
  version: number;
  lastUpdate: LastUpdate;
  lendingMarket: PublicKey;
  liquidity: ReserveLiquidity;
  collateral: ReserveCollateral;
  config: ReserveOnchainConfig;
  rateLimiter: RateLimiter;
  pubkey: PublicKey;
}

export type RawReserveType = ReturnType<typeof parseReserve>;

export interface ReserveLiquidity {
  mintPubkey: PublicKey;
  mintDecimals: number;
  supplyPubkey: PublicKey;
  oracleOption: number;
  pythOracle: PublicKey;
  switchboardOracle: PublicKey;
  availableAmount: BN;
  borrowedAmountWads: BN;
  cumulativeBorrowRateWads: BN;
  accumulatedProtocolFeesWads: BN;
  marketPrice: BN;
  smoothedMarketPrice: BN;
}

export interface ReserveCollateral {
  mintPubkey: PublicKey;
  mintTotalSupply: BN;
  supplyPubkey: PublicKey;
}

export interface ReserveOnchainConfig {
  optimalUtilizationRate: number;
  maxUtilizationRate: number;
  loanToValueRatio: number;
  liquidationBonus: number;
  maxLiquidationBonus: number;
  liquidationThreshold: number;
  maxLiquidationThreshold: number;
  minBorrowRate: number;
  optimalBorrowRate: number;
  maxBorrowRate: number;
  superMaxBorrowRate: BN;
  fees: {
    borrowFeeWad: BN;
    flashLoanFeeWad: BN;
    hostFeePercentage: number;
  };
  depositLimit: BN;
  borrowLimit: BN;
  feeReceiver: PublicKey;
  protocolLiquidationFee: number;
  protocolTakeRate: number;
  addedBorrowWeightBPS: BN;
  borrowWeight: string;
  reserveType: AssetType;
  extraOracle?: PublicKey;
  scaledPriceOffsetBPS: BN;
  attributedBorrowLimitOpen: BN;
  attributedBorrowLimitClose: BN;
  liquidityExtraMarketPriceFlag: number;
  liquidityExtraMarketPrice: BN;
  attributedBorrowValue: BN;
}

export enum AssetType {
  Regular = 0,
  Isolated = 1,
}

export const ReserveLayout: typeof BufferLayout.Structure = BufferLayout.struct(
  [
    BufferLayout.u8("version"),
    LastUpdateLayout,
    Layout.publicKey("lendingMarket"),
    Layout.publicKey("liquidityMintPubkey"),
    BufferLayout.u8("liquidityMintDecimals"),
    Layout.publicKey("liquiditySupplyPubkey"),
    Layout.publicKey("liquidityPythOracle"),
    Layout.publicKey("liquiditySwitchboardOracle"),
    Layout.uint64("liquidityAvailableAmount"),
    Layout.uint128("liquidityBorrowedAmountWads"),
    Layout.uint128("liquidityCumulativeBorrowRateWads"),
    Layout.uint128("liquidityMarketPrice"),
    Layout.publicKey("collateralMintPubkey"),
    Layout.uint64("collateralMintTotalSupply"),
    Layout.publicKey("collateralSupplyPubkey"),
    BufferLayout.u8("optimalUtilizationRate"),
    BufferLayout.u8("loanToValueRatio"),
    BufferLayout.u8("liquidationBonus"),
    BufferLayout.u8("liquidationThreshold"),
    BufferLayout.u8("minBorrowRate"),
    BufferLayout.u8("optimalBorrowRate"),
    BufferLayout.u8("maxBorrowRate"),
    Layout.uint64("borrowFeeWad"),
    Layout.uint64("flashLoanFeeWad"),
    BufferLayout.u8("hostFeePercentage"),
    Layout.uint64("depositLimit"),
    Layout.uint64("borrowLimit"),
    Layout.publicKey("feeReceiver"),
    BufferLayout.u8("protocolLiquidationFee"),
    BufferLayout.u8("protocolTakeRate"),
    Layout.uint128("accumulatedProtocolFeesWads"),
    RateLimiterLayout,
    Layout.uint64("addedBorrowWeightBPS"),
    Layout.uint128("liquiditySmoothedMarketPrice"),
    BufferLayout.u8("reserveType"),
    BufferLayout.u8("maxUtilizationRate"),
    Layout.uint64("superMaxBorrowRate"),
    BufferLayout.u8("maxLiquidationBonus"),
    BufferLayout.u8("maxLiquidationThreshold"),
    Layout.int64("scaledPriceOffsetBPS"),
    Layout.publicKey("extraOracle"),
    BufferLayout.u8("liquidityExtraMarketPriceFlag"),
    Layout.uint128("liquidityExtraMarketPrice"),
    Layout.uint128("attributedBorrowValue"),
    Layout.uint64("attributedBorrowLimitOpen"),
    Layout.uint64("attributedBorrowLimitClose"),
    BufferLayout.blob(49, "padding"),
  ],
);

function decodeReserve(buffer: Buffer, pubkey: PublicKey): Reserve {
  const reserve = ReserveLayout.decode(buffer);
  return {
    version: reserve.version,
    lastUpdate: reserve.lastUpdate,
    lendingMarket: reserve.lendingMarket,
    liquidity: {
      mintPubkey: reserve.liquidityMintPubkey,
      mintDecimals: reserve.liquidityMintDecimals,
      supplyPubkey: reserve.liquiditySupplyPubkey,
      oracleOption: reserve.liquidityOracleOption,
      pythOracle: reserve.liquidityPythOracle,
      switchboardOracle: reserve.liquiditySwitchboardOracle,
      availableAmount: reserve.liquidityAvailableAmount,
      borrowedAmountWads: reserve.liquidityBorrowedAmountWads,
      cumulativeBorrowRateWads: reserve.liquidityCumulativeBorrowRateWads,
      marketPrice: reserve.liquidityMarketPrice,
      accumulatedProtocolFeesWads: reserve.accumulatedProtocolFeesWads,
      smoothedMarketPrice: reserve.smoothedMarketPrice,
    },
    collateral: {
      mintPubkey: reserve.collateralMintPubkey,
      mintTotalSupply: reserve.collateralMintTotalSupply,
      supplyPubkey: reserve.collateralSupplyPubkey,
    },
    config: {
      optimalUtilizationRate: reserve.optimalUtilizationRate,
      maxUtilizationRate: Math.max(
        reserve.maxUtilizationRate,
        reserve.optimalUtilizationRate,
      ),
      loanToValueRatio: reserve.loanToValueRatio,
      liquidationBonus: reserve.liquidationBonus,
      maxLiquidationBonus: Math.max(
        reserve.maxLiquidationBonus,
        reserve.liquidationBonus,
      ),
      liquidationThreshold: reserve.liquidationThreshold,
      maxLiquidationThreshold: Math.max(
        reserve.maxLiquidationThreshold,
        reserve.liquidationThreshold,
      ),
      minBorrowRate: reserve.minBorrowRate,
      optimalBorrowRate: reserve.optimalBorrowRate,
      maxBorrowRate: reserve.maxBorrowRate,
      superMaxBorrowRate:
        reserve.superMaxBorrowRate > reserve.maxBorrowRate
          ? reserve.superMaxBorrowRate
          : new BN(reserve.maxBorrowRate),
      fees: {
        borrowFeeWad: reserve.borrowFeeWad,
        flashLoanFeeWad: reserve.flashLoanFeeWad,
        hostFeePercentage: reserve.hostFeePercentage,
      },
      depositLimit: reserve.depositLimit,
      borrowLimit: reserve.borrowLimit,
      feeReceiver: reserve.feeReceiver,
      protocolLiquidationFee: reserve.protocolLiquidationFee,
      protocolTakeRate: reserve.protocolTakeRate,
      addedBorrowWeightBPS: reserve.addedBorrowWeightBPS,
      borrowWeight:
        reserve.addedBorrowWeightBPS.toString() === U64_MAX
          ? U64_MAX
          : new BigNumber(reserve.addedBorrowWeightBPS.toString())
              .dividedBy(new BigNumber(10000))
              .plus(new BigNumber(1))
              .toString(),
      reserveType:
        reserve.reserveType == 0 ? AssetType.Regular : AssetType.Isolated,
      liquidityExtraMarketPriceFlag: reserve.liquidityExtraMarketPriceFlag,
      liquidityExtraMarketPrice: reserve.liquidityExtraMarketPrice,
      attributedBorrowValue: reserve.attributedBorrowValue,
      scaledPriceOffsetBPS: reserve.scaledPriceOffsetBPS,
      extraOracle: reserve.extraOracle,
      attributedBorrowLimitOpen: reserve.attributedBorrowLimitOpen,
      attributedBorrowLimitClose: reserve.attributedBorrowLimitClose,
    },
    rateLimiter: reserve.rateLimiter,
    pubkey,
  };
}

export const RESERVE_SIZE = ReserveLayout.span;

export const isReserve = (info: AccountInfo<Buffer>) =>
  info.data.length === RESERVE_SIZE;

export const parseReserve = (
  pubkey: PublicKey,
  info: AccountInfo<Buffer>,
  encoding?: string,
) => {
  const { data } = info;
  const buffer = Buffer.from(data);
  const reserve = decodeReserve(buffer, pubkey);

  const details = {
    pubkey,
    account: {
      ...info,
    },
    info: reserve,
  };

  return details;
};

export type FormattedReserveType = ReturnType<typeof formatReserve>;

export function formatReserve(
  reserve: RawReserveType,
  priceData?: {
    spotPrice: number;
    emaPrice: number;
    lstAdjustmentRatio?: BigNumber;
    priceSource?: string;
  },
  currentSlot?: number,
  metadata?: {
    symbol: string;
    logo: string;
    name?: string;
  },
  config?: {
    showApy: boolean;
    avgSlotTime: number;
  },
) {
  const decimals = reserve.info.liquidity.mintDecimals;
  const availableAmount = new BigNumber(
    reserve.info.liquidity.availableAmount.toString(),
  ).shiftedBy(-decimals);
  const totalBorrow = new BigNumber(
    reserve.info.liquidity.borrowedAmountWads.toString(),
  ).shiftedBy(-18 - decimals);
  const accumulatedProtocolFees = new BigNumber(
    reserve.info.liquidity.accumulatedProtocolFeesWads.toString(),
  ).shiftedBy(-18 - decimals);
  const totalSupply = totalBorrow
    .plus(availableAmount)
    .minus(accumulatedProtocolFees);
  const address = reserve.pubkey.toBase58();
  const priceResolved = priceData
    ? BigNumber(priceData.spotPrice)
    : new BigNumber(reserve.info.liquidity.marketPrice.toString()).shiftedBy(
        -18,
      );

  const cTokenExchangeRate = new BigNumber(totalSupply).dividedBy(
    new BigNumber(reserve.info.collateral.mintTotalSupply.toString()).shiftedBy(
      -decimals,
    ),
  );
  const cumulativeBorrowRate = new BigNumber(
    reserve.info.liquidity.cumulativeBorrowRateWads.toString(),
  ).shiftedBy(-18);

  const lstPatch = priceData?.lstAdjustmentRatio
    ? {
        loanToValueRatio:
          Number(
            new BigNumber(reserve.info.config.loanToValueRatio)
              .div(priceData.lstAdjustmentRatio)
              .toString(),
          ) / 100,
        liquidationThreshold:
          Number(
            new BigNumber(reserve.info.config.liquidationThreshold)
              .div(priceData.lstAdjustmentRatio)
              .toString(),
          ) / 100,
        maxLiquidationThreshold:
          Number(
            new BigNumber(reserve.info.config.maxLiquidationThreshold)
              .div(priceData.lstAdjustmentRatio)
              .toString(),
          ) / 100,
        liquidationBonus: Number(
          new BigNumber(reserve.info.config.liquidationBonus)
            .plus(new BigNumber(1))
            .times(priceData.lstAdjustmentRatio)
            .minus(new BigNumber(1))
            .toString(),
        ),
        maxLiquidationBonus: Number(
          new BigNumber(reserve.info.config.maxLiquidationBonus)
            .plus(new BigNumber(1))
            .times(priceData.lstAdjustmentRatio)
            .minus(new BigNumber(1))
            .toString(),
        ),
      }
    : {};

  return {
    disabled:
      reserve.info.config.depositLimit.toString() === "0" &&
      reserve.info.config.borrowLimit.toString() === "0",
    cumulativeBorrowRate,
    cTokenExchangeRate,
    name: metadata?.name,
    accumulatedProtocolFees,
    reserveUtilization: totalBorrow.dividedBy(totalSupply),
    cTokenMint: reserve.info.collateral.mintPubkey.toBase58(),
    feeReceiverAddress: reserve.info.config.feeReceiver?.toBase58(),
    reserveSupplyLimit: new BigNumber(
      reserve.info.config.depositLimit.toString(),
    ).shiftedBy(-decimals),
    reserveBorrowLimit: new BigNumber(
      reserve.info.config.borrowLimit.toString(),
    ).shiftedBy(-decimals),
    borrowFee: new BigNumber(
      reserve.info.config.fees.borrowFeeWad.toString(),
    ).shiftedBy(-18),
    flashLoanFee: new BigNumber(
      reserve.info.config.fees.flashLoanFeeWad.toString(),
    ).shiftedBy(-18),
    protocolLiquidationFee: reserve.info.config.protocolLiquidationFee / 1000,
    hostFee: reserve.info.config.fees.hostFeePercentage / 100,
    interestRateSpread: reserve.info.config.protocolTakeRate / 100,
    targetBorrowApr: reserve.info.config.optimalBorrowRate / 100,
    targetUtilization: reserve.info.config.optimalUtilizationRate / 100,
    maxUtilizationRate: reserve.info.config.maxUtilizationRate / 100,
    minBorrowApr: reserve.info.config.minBorrowRate / 100,
    maxBorrowApr: reserve.info.config.maxBorrowRate / 100,
    superMaxBorrowRate: reserve.info.config.superMaxBorrowRate.toNumber() / 100,
    supplyInterest: calculateSupplyInterest(
      reserve.info,
      Boolean(config?.showApy),
    ).times(0.5 / (config?.avgSlotTime ?? 0.5)),
    borrowInterest: calculateBorrowInterest(
      reserve.info,
      Boolean(config?.showApy),
    ).times(0.5 / (config?.avgSlotTime ?? 0.5)),
    totalSupply,
    totalBorrow,
    availableAmount,
    rateLimiter: parseRateLimiter(reserve.info.rateLimiter, currentSlot),
    totalSupplyUsd: totalSupply.times(priceResolved),
    totalBorrowUsd: totalBorrow.times(priceResolved),
    availableAmountUsd: availableAmount.times(priceResolved),
    loanToValueRatio:
      lstPatch.loanToValueRatio ?? reserve.info.config.loanToValueRatio / 100,
    liquidationThreshold:
      lstPatch.liquidationThreshold ??
      reserve.info.config.liquidationThreshold / 100,
    maxLiquidationThreshold:
      lstPatch.maxLiquidationThreshold ??
      reserve.info.config.maxLiquidationThreshold / 100,
    liquidationBonus:
      lstPatch.liquidationBonus ?? reserve.info.config.liquidationBonus / 100,
    maxLiquidationBonus:
      lstPatch.maxLiquidationBonus ??
      reserve.info.config.maxLiquidationBonus / 100,
    liquidityAddress: reserve.info.liquidity.supplyPubkey.toBase58(),
    cTokenLiquidityAddress: reserve.info.collateral.supplyPubkey.toBase58(),
    liquidityFeeReceiverAddress: reserve.info.config.feeReceiver.toBase58(),
    address,
    mintAddress: reserve.info.liquidity.mintPubkey.toBase58(),
    decimals,
    symbol: metadata?.symbol ?? reserve.info.liquidity.mintPubkey.toBase58(),
    logo: metadata?.logo,
    price: priceResolved,
    poolAddress: reserve.info.lendingMarket.toBase58(),
    pythOracle: reserve.info.liquidity.pythOracle.toBase58(),
    switchboardOracle: reserve.info.liquidity.switchboardOracle.toBase58(),
    addedBorrowWeightBPS: reserve.info.config.addedBorrowWeightBPS,
    borrowWeight: reserve.info.config.borrowWeight,
    priceData,
    emaPrice: priceData?.emaPrice,
    minPrice:
      priceData?.emaPrice && priceData?.spotPrice
        ? BigNumber.min(priceData.emaPrice, priceData.spotPrice)
        : new BigNumber(priceData?.spotPrice ?? priceResolved),
    maxPrice:
      priceData?.emaPrice && priceData?.spotPrice
        ? BigNumber.max(priceData.emaPrice, priceData.spotPrice)
        : new BigNumber(priceData?.spotPrice ?? priceResolved),
    reserveType: reserve.info.config.reserveType,
    scaledPriceOffsetBPS: reserve.info.config.scaledPriceOffsetBPS,
    extraOracle: reserve.info.config.extraOracle?.toBase58(),
    liquidityExtraMarketPriceFlag:
      reserve.info.config.liquidityExtraMarketPriceFlag,
    liquidityExtraMarketPrice: reserve.info.config.liquidityExtraMarketPrice,
    attributedBorrowValue: reserve.info.config.attributedBorrowValue,
    attributedBorrowLimitOpen: reserve.info.config.attributedBorrowLimitOpen,
    attributedBorrowLimitClose: reserve.info.config.attributedBorrowLimitClose,
  };
}
