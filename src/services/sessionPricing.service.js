import Decimal from "decimal.js";
import { getCurrentPricingTier, resolveCurrentTierPricing } from "../utils/timeUtils.js";
import { PricingMode } from "../middleware/clientCompatibility.middleware.js";

function toDecimal(value, fallback = "0") {
  return new Decimal(value?.toString() || fallback);
}

function resolveBaseRate(pricing) {
  return toDecimal(pricing?.pricePerKwh);
}

function resolveTouRate(pricing, now) {
  const tier = getCurrentPricingTier(now);
  const { currentTier, currentTierPrice } = resolveCurrentTierPricing(pricing, tier);
  return {
    tier: currentTier,
    rate: currentTierPrice == null ? resolveBaseRate(pricing) : toDecimal(currentTierPrice),
  };
}

/**
 * Produces a pricing snapshot at the exact start of a newly-created session.
 * The result is serializable and does not require any additional API call.
 */
export function resolveSessionStartPricing({
  pricing,
  pricingMode = PricingMode.LEGACY_FLAT,
  membershipDiscountRate = "0",
  now = new Date(),
}) {
  const baseRate = resolveBaseRate(pricing);
  const isDynamicTou = pricingMode === PricingMode.DYNAMIC_TOU;
  const tou = isDynamicTou ? resolveTouRate(pricing, now) : { tier: null, rate: baseRate };
  const discount = isDynamicTou ? toDecimal(membershipDiscountRate) : new Decimal(0);
  const effectiveRate = tou.rate.times(new Decimal(1).minus(discount.dividedBy(100)));

  return {
    pricingMode: isDynamicTou ? PricingMode.DYNAMIC_TOU : PricingMode.LEGACY_FLAT,
    basePricePerKwh: baseRate.toFixed(2),
    lockedPricePerKwh: isDynamicTou ? null : effectiveRate.toFixed(2),
    effectiveStartPricePerKwh: effectiveRate.toFixed(2),
    membershipDiscountRate: discount.toFixed(2),
    currentTier: tou.tier,
  };
}

/**
 * Resolves the rate for a MeterValues increment. Sessions created before this
 * deployment intentionally retain the previous dynamic behaviour (null mode).
 */
export function resolveSessionMeterPrice({
  session,
  pricing,
  legacyMembershipDiscountRate = "0",
  now = new Date(),
}) {
  if (session.pricingMode === PricingMode.LEGACY_FLAT) {
    return {
      basePricePerKwh: toDecimal(session.basePricePerKwh ?? pricing?.pricePerKwh),
      pricePerKwh: toDecimal(session.lockedPricePerKwh ?? session.pricePerKwh ?? pricing?.pricePerKwh),
      membershipDiscountRate: new Decimal(0),
      currentTier: null,
    };
  }

  const dynamic = resolveTouRate(pricing, now);
  const discount = session.pricingMode === PricingMode.DYNAMIC_TOU
    ? toDecimal(session.membershipDiscountRate)
    : toDecimal(legacyMembershipDiscountRate);

  return {
    basePricePerKwh: dynamic.rate,
    pricePerKwh: dynamic.rate.times(new Decimal(1).minus(discount.dividedBy(100))),
    membershipDiscountRate: discount,
    currentTier: dynamic.tier,
  };
}
