import BN from "bn.js";
import BigNumber from "bignumber.js";
import * as Layout from "./buffer-layout";

import BufferLayout from "buffer-layout";

export interface RateLimiter {
  config: RateLimiterConfig;
  previousQuantity: BN;
  windowStart: BN;
  currentQuantity: BN;
}

export interface RateLimiterConfig {
  windowDuration: BN;
  maxOutflow: BN;
}

export const RateLimiterLayout = BufferLayout.struct(
  [
    BufferLayout.struct(
      [Layout.uint64("maxOutflow"), Layout.uint64("windowDuration")],
      "config",
    ),
    Layout.uint128("previousQuantity"),
    Layout.uint64("windowStart"),
    Layout.uint128("currentQuantity"),
  ],
  "rateLimiter",
);

export type ParsedRateLimiter = {
  config: {
    windowDuration: BigNumber;
    maxOutflow: BigNumber;
  };
  windowStart: BigNumber;
  previousQuantity: BigNumber;
  currentQuantity: BigNumber;
  remainingOutflow: BigNumber | null;
};

export function parseRateLimiter(
  rateLimiter: RateLimiter,
  currentSlot?: number,
): ParsedRateLimiter | null {
  if (!currentSlot) return null;

  const windowDuration = new BigNumber(
    rateLimiter.config.windowDuration.toString(),
  );
  const maxOutflow = new BigNumber(rateLimiter.config.maxOutflow.toString());
  const windowStart = new BigNumber(rateLimiter.windowStart.toString());
  const previousQuantity = new BigNumber(
    rateLimiter.previousQuantity.toString(),
  );
  const currentQuantity = new BigNumber(rateLimiter.currentQuantity.toString());

  if (windowDuration.isZero() || maxOutflow.isZero()) {
    return null;
  }

  const curSlot = new BigNumber(currentSlot);
  const elapsed = curSlot.minus(windowStart);

  let remainingOutflow: BigNumber;
  if (elapsed.isGreaterThanOrEqualTo(windowDuration.times(2))) {
    remainingOutflow = maxOutflow;
  } else if (elapsed.isGreaterThanOrEqualTo(windowDuration)) {
    const weight = windowDuration
      .times(2)
      .minus(elapsed)
      .dividedBy(windowDuration);
    remainingOutflow = maxOutflow.minus(currentQuantity.times(weight));
  } else {
    const previousWeight = windowDuration
      .minus(elapsed)
      .dividedBy(windowDuration);
    const used = previousQuantity.times(previousWeight).plus(currentQuantity);
    remainingOutflow = maxOutflow.minus(used);
  }

  return {
    config: { windowDuration, maxOutflow },
    windowStart,
    previousQuantity,
    currentQuantity,
    remainingOutflow: BigNumber.max(remainingOutflow, 0),
  };
}
