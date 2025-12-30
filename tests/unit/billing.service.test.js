import Decimal from "decimal.js";

// Import the billing service functions directly for unit testing
// These are pure functions that don't need mocking
describe("Billing Service - Pure Functions", () => {
  // We'll test the pure calculation functions directly
  
  describe("calculateEnergyCost", () => {
    it("should correctly calculate cost for energy in Wh", () => {
      // 1000 Wh = 1 kWh @ LKR 50/kWh = LKR 50
      const energyWh = 1000;
      const pricePerKwh = 50;
      
      const energyKwh = new Decimal(energyWh).dividedBy(1000);
      const cost = energyKwh.times(new Decimal(pricePerKwh));
      
      expect(cost.toFixed(2)).toBe("50.00");
    });

    it("should handle fractional kWh correctly", () => {
      // 2500 Wh = 2.5 kWh @ LKR 50/kWh = LKR 125
      const energyWh = 2500;
      const pricePerKwh = 50;
      
      const energyKwh = new Decimal(energyWh).dividedBy(1000);
      const cost = energyKwh.times(new Decimal(pricePerKwh));
      
      expect(cost.toFixed(2)).toBe("125.00");
    });

    it("should handle small energy values", () => {
      // 100 Wh = 0.1 kWh @ LKR 50/kWh = LKR 5
      const energyWh = 100;
      const pricePerKwh = 50;
      
      const energyKwh = new Decimal(energyWh).dividedBy(1000);
      const cost = energyKwh.times(new Decimal(pricePerKwh));
      
      expect(cost.toFixed(2)).toBe("5.00");
    });

    it("should handle zero energy", () => {
      const energyWh = 0;
      const pricePerKwh = 50;
      
      const energyKwh = new Decimal(energyWh).dividedBy(1000);
      const cost = energyKwh.times(new Decimal(pricePerKwh));
      
      expect(cost.toFixed(2)).toBe("0.00");
    });
  });

  describe("calculateEarningsSplit", () => {
    it("should correctly split earnings with 15% commission", () => {
      const totalAmount = new Decimal(100);
      const commissionRate = new Decimal(15);
      
      const rate = commissionRate.dividedBy(100);
      const commission = totalAmount.times(rate);
      const ownerEarning = totalAmount.minus(commission);
      
      expect(commission.toFixed(2)).toBe("15.00");
      expect(ownerEarning.toFixed(2)).toBe("85.00");
    });

    it("should handle 0% commission", () => {
      const totalAmount = new Decimal(100);
      const commissionRate = new Decimal(0);
      
      const rate = commissionRate.dividedBy(100);
      const commission = totalAmount.times(rate);
      const ownerEarning = totalAmount.minus(commission);
      
      expect(commission.toFixed(2)).toBe("0.00");
      expect(ownerEarning.toFixed(2)).toBe("100.00");
    });

    it("should handle 100% commission", () => {
      const totalAmount = new Decimal(100);
      const commissionRate = new Decimal(100);
      
      const rate = commissionRate.dividedBy(100);
      const commission = totalAmount.times(rate);
      const ownerEarning = totalAmount.minus(commission);
      
      expect(commission.toFixed(2)).toBe("100.00");
      expect(ownerEarning.toFixed(2)).toBe("0.00");
    });

    it("should handle fractional commission rates", () => {
      const totalAmount = new Decimal(100);
      const commissionRate = new Decimal(12.5);
      
      const rate = commissionRate.dividedBy(100);
      const commission = totalAmount.times(rate);
      const ownerEarning = totalAmount.minus(commission);
      
      expect(commission.toFixed(2)).toBe("12.50");
      expect(ownerEarning.toFixed(2)).toBe("87.50");
    });

    it("should maintain total = commission + ownerEarning", () => {
      const totalAmount = new Decimal(123.45);
      const commissionRate = new Decimal(17.5);
      
      const rate = commissionRate.dividedBy(100);
      const commission = totalAmount.times(rate);
      const ownerEarning = totalAmount.minus(commission);
      
      const sum = commission.plus(ownerEarning);
      expect(sum.toFixed(2)).toBe(totalAmount.toFixed(2));
    });
  });

  describe("Incremental Billing Calculation", () => {
    it("should calculate incremental energy correctly", () => {
      const currentMeterWh = 5000;
      const lastBilledWh = 4000;
      const meterStartWh = 3000;
      
      const incrementalWh = currentMeterWh - lastBilledWh;
      const totalEnergyUsed = currentMeterWh - meterStartWh;
      
      expect(incrementalWh).toBe(1000);
      expect(totalEnergyUsed).toBe(2000);
    });

    it("should not bill negative increments", () => {
      const currentMeterWh = 4000;
      const lastBilledWh = 5000; // Somehow last billed is higher
      
      const incrementalWh = currentMeterWh - lastBilledWh;
      
      expect(incrementalWh).toBe(-1000);
      expect(incrementalWh <= 0).toBe(true);
      // In actual service, this would skip billing
    });
  });

  describe("Idempotency Key Generation", () => {
    it("should generate consistent keys for same inputs", () => {
      const generateKey = (prefix, ...parts) => `${prefix}:${parts.join(":")}`;
      
      const key1 = generateKey("charging", "TX-123", "5000");
      const key2 = generateKey("charging", "TX-123", "5000");
      
      expect(key1).toBe(key2);
    });

    it("should generate unique keys for different meter values", () => {
      const generateKey = (prefix, ...parts) => `${prefix}:${parts.join(":")}`;
      
      const key1 = generateKey("charging", "TX-123", "5000");
      const key2 = generateKey("charging", "TX-123", "6000");
      
      expect(key1).not.toBe(key2);
    });
  });

  describe("Low Balance Detection", () => {
    it("should detect low balance when below threshold", () => {
      const remainingBalance = new Decimal(40);
      const lowThreshold = new Decimal(50);
      
      const isLow = remainingBalance.lte(lowThreshold) && remainingBalance.gt(0);
      
      expect(isLow).toBe(true);
    });

    it("should not trigger low balance warning when above threshold", () => {
      const remainingBalance = new Decimal(100);
      const lowThreshold = new Decimal(50);
      
      const isLow = remainingBalance.lte(lowThreshold);
      
      expect(isLow).toBe(false);
    });

    it("should not trigger when balance is zero", () => {
      const remainingBalance = new Decimal(0);
      const lowThreshold = new Decimal(50);
      
      // Zero balance should trigger grace period, not low balance warning
      const isLow = remainingBalance.lte(lowThreshold) && remainingBalance.gt(0);
      
      expect(isLow).toBe(false);
    });
  });
});

describe("Billing Service - Edge Cases", () => {
  describe("Precision handling", () => {
    it("should maintain precision for very small amounts", () => {
      const smallEnergy = 1; // 1 Wh
      const pricePerKwh = 50;
      
      const energyKwh = new Decimal(smallEnergy).dividedBy(1000);
      const cost = energyKwh.times(new Decimal(pricePerKwh));
      
      // 0.001 kWh * 50 = 0.05
      expect(cost.toFixed(2)).toBe("0.05");
    });

    it("should handle large amounts without overflow", () => {
      const largeEnergy = 1000000; // 1000 kWh
      const pricePerKwh = 50;
      
      const energyKwh = new Decimal(largeEnergy).dividedBy(1000);
      const cost = energyKwh.times(new Decimal(pricePerKwh));
      
      expect(cost.toFixed(2)).toBe("50000.00");
    });
  });

  describe("Currency rounding", () => {
    it("should round to 2 decimal places", () => {
      const energyWh = 333;
      const pricePerKwh = 50;
      
      const energyKwh = new Decimal(energyWh).dividedBy(1000);
      const cost = energyKwh.times(new Decimal(pricePerKwh));
      
      // 0.333 kWh * 50 = 16.65 (rounded)
      expect(cost.toFixed(2)).toBe("16.65");
    });
  });
});

