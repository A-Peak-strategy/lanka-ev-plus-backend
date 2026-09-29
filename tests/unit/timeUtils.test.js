import {
  getCurrentPricingTier,
  resolveCurrentTierPricing,
} from "../../src/utils/timeUtils.js";

describe("time-of-use pricing utilities", () => {
  test.each([
    ["2026-09-28T00:00:00.000Z", "DAY"],
    ["2026-09-28T12:59:59.000Z", "DAY"],
    ["2026-09-28T13:00:00.000Z", "PEAK"],
    ["2026-09-28T16:59:59.000Z", "PEAK"],
    ["2026-09-28T17:00:00.000Z", "OFF_PEAK"],
    ["2026-09-28T23:59:59.000Z", "OFF_PEAK"],
  ])("resolves %s to the %s Colombo tier", (timestamp, expectedTier) => {
    expect(getCurrentPricingTier(new Date(timestamp))).toBe(expectedTier);
  });

  test("selects the configured price for the active TOU tier", () => {
    const result = resolveCurrentTierPricing(
      {
        isTouEnabled: true,
        peakPrice: "70.00",
        dayPrice: "15.00",
        offPeakPrice: "31.00",
      },
      "PEAK",
    );

    expect(result).toEqual({
      currentTier: "PEAK",
      currentTierPrice: "70.00",
    });
  });

  test("uses flat pricing fields when TOU is disabled", () => {
    expect(
      resolveCurrentTierPricing(
        { isTouEnabled: false, pricePerKwh: "50.00" },
        "DAY",
      ),
    ).toEqual({ currentTier: null, currentTierPrice: null });
  });

  test("falls back safely when the active tier price is missing", () => {
    expect(
      resolveCurrentTierPricing(
        {
          isTouEnabled: true,
          pricePerKwh: "50.00",
          peakPrice: null,
        },
        "PEAK",
      ),
    ).toEqual({ currentTier: null, currentTierPrice: null });
  });
});
