import { resolveClientCompatibility, PricingMode } from "../../src/middleware/clientCompatibility.middleware.js";
import { resolveSessionStartPricing, resolveSessionMeterPrice } from "../../src/services/sessionPricing.service.js";

const pricing = {
  pricePerKwh: "50.00",
  isTouEnabled: true,
  peakPrice: "70.00",
  dayPrice: "45.00",
  offPeakPrice: "31.00",
};

const features = {
  legacyClientCompatibility: true,
  enableTouForLegacyClients: false,
  enableTouForCapableClients: true,
  enableMembershipPricing: true,
};

describe("client compatibility", () => {
  it("treats a released app without headers as a legacy flat-rate client", () => {
    const compatibility = resolveClientCompatibility({}, features);

    expect(compatibility.pricingMode).toBe(PricingMode.LEGACY_FLAT);
    expect(compatibility.applyMembershipPricing).toBe(false);
  });

  it("enables dynamic TOU only for a client that explicitly declares support", () => {
    const compatibility = resolveClientCompatibility({
      "x-app-version": "1.1.0",
      "x-app-platform": "android",
      "x-client-capabilities": "tou-pricing, membership-pricing",
    }, features);

    expect(compatibility.pricingMode).toBe(PricingMode.DYNAMIC_TOU);
    expect(compatibility.applyMembershipPricing).toBe(true);
    expect(compatibility.appVersion).toBe("1.1.0");
  });
});

describe("session pricing snapshots", () => {
  it("locks an old client to the base rate for the entire charge", () => {
    const snapshot = resolveSessionStartPricing({
      pricing,
      pricingMode: PricingMode.LEGACY_FLAT,
      membershipDiscountRate: "15",
      now: new Date("2026-01-01T13:30:00.000Z"), // 19:00 Colombo, peak
    });

    expect(snapshot.lockedPricePerKwh).toBe("50.00");
    expect(snapshot.effectiveStartPricePerKwh).toBe("50.00");

    const meterRate = resolveSessionMeterPrice({
      session: snapshot,
      pricing,
      now: new Date("2026-01-01T23:00:00.000Z"), // 04:30 Colombo, off-peak
    });
    expect(meterRate.pricePerKwh.toFixed(2)).toBe("50.00");
  });

  it("applies TOU and the membership snapshot for a capable client", () => {
    const snapshot = resolveSessionStartPricing({
      pricing,
      pricingMode: PricingMode.DYNAMIC_TOU,
      membershipDiscountRate: "15",
      now: new Date("2026-01-01T13:30:00.000Z"), // 19:00 Colombo, peak
    });

    expect(snapshot.effectiveStartPricePerKwh).toBe("59.50");
    expect(snapshot.membershipDiscountRate).toBe("15.00");

    const meterRate = resolveSessionMeterPrice({
      session: snapshot,
      pricing,
      now: new Date("2026-01-01T23:00:00.000Z"), // 04:30 Colombo, off-peak
    });
    expect(meterRate.pricePerKwh.toFixed(2)).toBe("26.35");
  });

  it("keeps pre-rollout sessions on their historic dynamic behaviour", () => {
    const meterRate = resolveSessionMeterPrice({
      session: { pricingMode: null },
      pricing,
      legacyMembershipDiscountRate: "10",
      now: new Date("2026-01-01T13:30:00.000Z"),
    });

    expect(meterRate.pricePerKwh.toFixed(2)).toBe("63.00");
  });
});
