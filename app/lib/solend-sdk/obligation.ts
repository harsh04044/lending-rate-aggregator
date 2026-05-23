import { type AccountInfo, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as Layout from "./buffer-layout";
import { LastUpdateLayout, type LastUpdate } from "./lastUpdate";
import BufferLayout from "buffer-layout";
import type { FormattedReserveType } from "./reserve";
import { U64_MAX } from "./constants";
import BigNumber from "bignumber.js";

export interface Obligation {
  version: number;
  lastUpdate: LastUpdate;
  lendingMarket: PublicKey;
  owner: PublicKey;
  deposits: ObligationCollateral[];
  borrows: ObligationLiquidity[];
  depositedValue: BN;
  borrowedValue: BN;
  borrowedValueUpperBound: BN;
  allowedBorrowValue: BN;
  unhealthyBorrowValue: BN;
  borrowingIsolatedAsset: boolean;
  unweightedBorrowValue: BN;
  superUnhealthyBorrowValue: BN;
  closeable: boolean;
  pubkey: PublicKey;
}

// BN defines toJSON property, which messes up serialization
// @ts-expect-error Just ignore it!!
BN.prototype.toJSON = undefined;

export interface ObligationCollateral {
  depositReserve: PublicKey;
  depositedAmount: BN;
  marketValue: BN;
}

export interface ObligationLiquidity {
  borrowReserve: PublicKey;
  cumulativeBorrowRateWads: BN;
  borrowedAmountWads: BN;
  marketValue: BN;
}

export const ObligationLayout: typeof BufferLayout.Structure =
  BufferLayout.struct([
    BufferLayout.u8("version"),
    LastUpdateLayout,
    Layout.publicKey("lendingMarket"),
    Layout.publicKey("owner"),
    Layout.uint128("depositedValue"),
    Layout.uint128("borrowedValue"),
    Layout.uint128("allowedBorrowValue"),
    Layout.uint128("unhealthyBorrowValue"),
    Layout.uint128("borrowedValueUpperBound"),
    BufferLayout.u8("borrowingIsolatedAsset"),
    Layout.uint128("superUnhealthyBorrowValue"),
    Layout.uint128("unweightedBorrowValue"),
    BufferLayout.u8("closeable"),
    BufferLayout.blob(14, "_padding"),
    BufferLayout.u8("depositsLen"),
    BufferLayout.u8("borrowsLen"),
    BufferLayout.blob(1096, "dataFlat"),
  ]);

export const ObligationCollateralLayout: typeof BufferLayout.Structure =
  BufferLayout.struct([
    Layout.publicKey("depositReserve"),
    Layout.uint64("depositedAmount"),
    Layout.uint128("marketValue"),
    BufferLayout.blob(32, "padding"),
  ]);

export const ObligationLiquidityLayout: typeof BufferLayout.Structure =
  BufferLayout.struct([
    Layout.publicKey("borrowReserve"),
    Layout.uint128("cumulativeBorrowRateWads"),
    Layout.uint128("borrowedAmountWads"),
    Layout.uint128("marketValue"),
    BufferLayout.blob(32, "padding"),
  ]);

export const OBLIGATION_SIZE = ObligationLayout.span;

export const isObligation = (info: AccountInfo<Buffer>) =>
  info.data.length === ObligationLayout.span;

export interface ProtoObligation {
  version: number;
  lastUpdate: LastUpdate;
  lendingMarket: PublicKey;
  owner: PublicKey;
  depositedValue: BN;
  borrowedValue: BN;
  allowedBorrowValue: BN;
  unhealthyBorrowValue: BN;
  borrowedValueUpperBound: BN;
  borrowingIsolatedAsset: boolean;
  unweightedBorrowValue: BN;
  superUnhealthyBorrowValue: BN;
  closeable: boolean;
  depositsLen: number;
  borrowsLen: number;
  dataFlat: Buffer;
}

export const parseObligation = (
  pubkey: PublicKey,
  info: AccountInfo<Buffer>,
  encoding?: string,
) => {
  const { data } = info;
  const buffer = Buffer.from(data);
  const {
    version,
    lastUpdate,
    lendingMarket,
    owner,
    depositedValue,
    borrowedValue,
    allowedBorrowValue,
    unhealthyBorrowValue,
    borrowedValueUpperBound,
    borrowingIsolatedAsset,
    unweightedBorrowValue,
    superUnhealthyBorrowValue,
    closeable,
    depositsLen,
    borrowsLen,
    dataFlat,
  } = ObligationLayout.decode(buffer) as ProtoObligation;

  const depositsBuffer = dataFlat.slice(
    0,
    depositsLen * ObligationCollateralLayout.span,
  );
  const deposits = BufferLayout.seq(
    ObligationCollateralLayout,
    depositsLen,
  ).decode(depositsBuffer) as ObligationCollateral[];

  const borrowsBuffer = dataFlat.slice(
    depositsBuffer.length,
    depositsLen * ObligationCollateralLayout.span +
      borrowsLen * ObligationLiquidityLayout.span,
  );
  const borrows = BufferLayout.seq(
    ObligationLiquidityLayout,
    borrowsLen,
  ).decode(borrowsBuffer) as ObligationLiquidity[];

  const obligation = {
    version,
    lastUpdate,
    lendingMarket,
    owner,
    depositedValue,
    borrowedValue,
    allowedBorrowValue,
    unhealthyBorrowValue,
    borrowedValueUpperBound,
    borrowingIsolatedAsset,
    unweightedBorrowValue,
    superUnhealthyBorrowValue,
    closeable,
    deposits,
    borrows,
    pubkey,
  } as Obligation;

  const details = {
    pubkey,
    account: {
      ...info,
    },
    info: obligation,
  };

  return details;
};

export type FormattedObligationType = ReturnType<typeof formatObligation>;

export function formatObligation(
  obligation: { pubkey: PublicKey; info: Obligation },
  reserveMap: { [key: string]: FormattedReserveType },
) {
  const poolAddress = obligation.info.lendingMarket.toBase58();
  let minPriceUserTotalSupply = new BigNumber(0);
  let minPriceBorrowLimit = new BigNumber(0);
  let maxPriceUserTotalWeightedBorrow = new BigNumber(0);

  const deposits = obligation.info.deposits.map((d) => {
    const reserveAddress = d.depositReserve.toBase58();
    const reserve = reserveMap[reserveAddress];

    if (!reserve)
      throw Error("Deposit in obligation does not exist in the pool");

    const amount = new BigNumber(d.depositedAmount.toString())
      .shiftedBy(-reserve.decimals)
      .times(reserve.cTokenExchangeRate);
    const amountUsd = amount.times(reserve.price);

    minPriceUserTotalSupply = minPriceUserTotalSupply.plus(
      amount.times(reserve.minPrice),
    );

    minPriceBorrowLimit = minPriceBorrowLimit.plus(
      amount.times(reserve.minPrice).times(reserve.loanToValueRatio),
    );

    return {
      liquidationThreshold: reserve.liquidationThreshold,
      maxLiquidationThreshold: reserve.maxLiquidationThreshold,
      loanToValueRatio: reserve.loanToValueRatio,
      symbol: reserve.symbol,
      price: reserve.price,
      mintAddress: reserve.mintAddress,
      reserveAddress,
      amount,
      amountUsd,
      annualInterest: amountUsd.multipliedBy(reserve.supplyInterest),
    };
  });

  const borrows = obligation.info.borrows.map((b) => {
    const reserveAddress = b.borrowReserve.toBase58();
    const reserve = reserveMap[reserveAddress];
    if (!reserve)
      throw Error("Borrow in obligation does not exist in the pool");

    const amount = new BigNumber(b.borrowedAmountWads.toString())
      .shiftedBy(-18 - reserve.decimals)
      .times(reserve.cumulativeBorrowRate)
      .dividedBy(
        new BigNumber(b.cumulativeBorrowRateWads.toString()).shiftedBy(-18),
      );
    const amountUsd = amount.times(reserve.price);

    const maxPrice = reserve.emaPrice
      ? BigNumber.max(reserve.emaPrice, reserve.price)
      : reserve.price;

    maxPriceUserTotalWeightedBorrow = maxPriceUserTotalWeightedBorrow.plus(
      amount
        .times(maxPrice)
        .times(reserve.borrowWeight ? reserve.borrowWeight : U64_MAX),
    );

    return {
      liquidationThreshold: reserve.liquidationThreshold,
      loanToValueRatio: reserve.loanToValueRatio,
      symbol: reserve.symbol,
      price: reserve.price,
      reserveAddress,
      mintAddress: reserve.mintAddress,
      borrowWeight: reserve.borrowWeight,
      amount,
      amountUsd,
      weightedAmountUsd: new BigNumber(reserve.borrowWeight).multipliedBy(
        amountUsd,
      ),
      annualInterest: amountUsd.multipliedBy(reserve.borrowInterest),
    };
  });

  const totalSupplyValue = deposits.reduce(
    (acc, d) => acc.plus(d.amountUsd),
    new BigNumber(0),
  );
  const totalBorrowValue = borrows.reduce(
    (acc, b) => acc.plus(b.amountUsd),
    new BigNumber(0),
  );
  const weightedTotalBorrowValue = borrows.reduce(
    (acc, b) => acc.plus(b.weightedAmountUsd),
    new BigNumber(0),
  );

  const borrowLimit = deposits.reduce(
    (acc, d) => d.amountUsd.times(d.loanToValueRatio).plus(acc),
    BigNumber(0),
  );
  const liquidationThreshold = deposits.reduce(
    (acc, d) => d.amountUsd.times(d.liquidationThreshold).plus(acc),
    BigNumber(0),
  );
  const superUnhealthyBorrowValue = deposits.reduce(
    (acc, d) => d.amountUsd.times(d.maxLiquidationThreshold).plus(acc),
    BigNumber(0),
  );
  const netAccountValue = totalSupplyValue.minus(totalBorrowValue);
  const liquidationThresholdFactor = totalSupplyValue.isZero()
    ? new BigNumber(0)
    : liquidationThreshold.dividedBy(totalSupplyValue);
  const borrowLimitFactor = totalSupplyValue.isZero()
    ? new BigNumber(0)
    : borrowLimit.dividedBy(totalSupplyValue);
  const borrowUtilization = borrowLimit.isZero()
    ? new BigNumber(0)
    : totalBorrowValue.dividedBy(borrowLimit);
  const weightedBorrowUtilization = minPriceBorrowLimit.isZero()
    ? new BigNumber(0)
    : weightedTotalBorrowValue.dividedBy(minPriceBorrowLimit);
  const isBorrowLimitReached = borrowUtilization.isGreaterThanOrEqualTo(
    new BigNumber("1"),
  );
  const borrowOverSupply = totalSupplyValue.isZero()
    ? new BigNumber(0)
    : totalBorrowValue.dividedBy(totalSupplyValue);

  const positions =
    obligation.info.deposits.filter((d) => !d.depositedAmount.isZero()).length +
    obligation.info.borrows.filter((b) => !b.borrowedAmountWads.isZero())
      .length;

  const weightedConservativeBorrowUtilization = minPriceBorrowLimit.isZero()
    ? new BigNumber(0)
    : maxPriceUserTotalWeightedBorrow.dividedBy(minPriceBorrowLimit);

  const annualSupplyInterest = deposits.reduce(
    (acc, d) => d.annualInterest.plus(acc),
    new BigNumber(0),
  );
  const annualBorrowInterest = borrows.reduce(
    (acc, b) => b.annualInterest.plus(acc),
    new BigNumber(0),
  );
  const netApy = annualSupplyInterest
    .minus(annualBorrowInterest)
    .div(netAccountValue.toString());

  return {
    address: obligation.pubkey.toBase58(),
    owner: obligation.info.owner.toBase58(),
    closeable: obligation.info.closeable,
    positions,
    deposits,
    borrows,
    poolAddress,
    totalSupplyValue,
    totalBorrowValue,
    borrowLimit,
    liquidationThreshold,
    netAccountValue,
    liquidationThresholdFactor,
    superUnhealthyBorrowValue,
    borrowLimitFactor,
    borrowUtilization,
    weightedConservativeBorrowUtilization,
    weightedBorrowUtilization,
    isBorrowLimitReached,
    borrowOverSupply,
    weightedTotalBorrowValue,
    minPriceUserTotalSupply,
    minPriceBorrowLimit,
    maxPriceUserTotalWeightedBorrow,
    netApy,
  };
}
