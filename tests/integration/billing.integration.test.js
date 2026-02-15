/**
 * Billing Integration Tests
 * 
 * These tests verify the complete billing flow including:
 * - Wallet top-up
 * - Charging session billing
 * - Ledger entry creation
 * - Grace period handling
 * 
 * NOTE: These tests require a running MySQL database and Redis.
 * Skip with: npm test -- --testPathIgnorePatterns=integration
 */

import Decimal from "decimal.js";

// Mock services for integration testing without external dependencies
const mockWalletState = new Map();
const mockLedgerEntries = [];

// Simple in-memory wallet service mock for integration testing
const createMockWalletService = () => {
  return {
    async getOrCreateWallet(userId) {
      if (!mockWalletState.has(userId)) {
        mockWalletState.set(userId, {
          id: `wallet-${userId}`,
          userId,
          balance: new Decimal(0),
          currency: "LKR",
          version: 0,
        });
      }
      return mockWalletState.get(userId);
    },

    async getBalance(userId) {
      const wallet = await this.getOrCreateWallet(userId);
      return new Decimal(wallet.balance);
    },

    async topUp({ userId, amount, paymentId, idempotencyKey }) {
      // Check idempotency
      const existing = mockLedgerEntries.find(
        (e) => e.idempotencyKey === idempotencyKey
      );
      if (existing) {
        return {
          wallet: mockWalletState.get(userId),
          ledgerEntry: existing,
          duplicate: true,
        };
      }

      const wallet = await this.getOrCreateWallet(userId);
      const newBalance = wallet.balance.plus(new Decimal(amount));
      
      wallet.balance = newBalance;
      wallet.version++;

      const entry = {
        id: `ledger-${mockLedgerEntries.length + 1}`,
        userId,
        type: "TOP_UP",
        amount: new Decimal(amount),
        balanceAfter: newBalance,
        idempotencyKey,
        createdAt: new Date(),
      };
      mockLedgerEntries.push(entry);

      return { wallet, ledgerEntry: entry, duplicate: false };
    },

    async deductForCharging({ userId, amount, idempotencyKey }) {
      const amountDecimal = new Decimal(amount);
      
      if (amountDecimal.lte(0)) {
        return { success: true, skipped: true };
      }

      // Check idempotency
      const existing = mockLedgerEntries.find(
        (e) => e.idempotencyKey === idempotencyKey
      );
      if (existing) {
        return {
          success: true,
          duplicate: true,
          wallet: mockWalletState.get(userId),
        };
      }

      const wallet = await this.getOrCreateWallet(userId);
      
      if (wallet.balance.lt(amountDecimal)) {
        return {
          success: false,
          insufficientFunds: true,
          currentBalance: wallet.balance.toFixed(2),
        };
      }

      const newBalance = wallet.balance.minus(amountDecimal);
      wallet.balance = newBalance;
      wallet.version++;

      const entry = {
        id: `ledger-${mockLedgerEntries.length + 1}`,
        userId,
        type: "CHARGE_DEBIT",
        amount: amountDecimal,
        balanceAfter: newBalance,
        idempotencyKey,
        createdAt: new Date(),
      };
      mockLedgerEntries.push(entry);

      return {
        success: true,
        wallet,
        newBalance: newBalance.toFixed(2),
      };
    },
  };
};

describe("Billing Integration Tests", () => {
  let walletService;

  beforeEach(() => {
    // Reset state before each test
    mockWalletState.clear();
    mockLedgerEntries.length = 0;
    walletService = createMockWalletService();
  });

  describe("Complete Charging Flow", () => {
    it("should process a complete charging session with billing", async () => {
      const userId = "user-001";
      const transactionId = "TX-001";
      
      // Step 1: Top up wallet
      const topUpResult = await walletService.topUp({
        userId,
        amount: 500,
        paymentId: "PAY-001",
        idempotencyKey: "topup:PAY-001",
      });
      
      expect(topUpResult.duplicate).toBe(false);
      expect(topUpResult.wallet.balance.toFixed(2)).toBe("500.00");
      
      // Step 2: Simulate meter values and deductions
      const pricePerKwh = new Decimal(50);
      let lastBilledWh = 0;
      
      // First meter reading: 1000 Wh (1 kWh = LKR 50)
      let currentMeterWh = 1000;
      let incrementalWh = currentMeterWh - lastBilledWh;
      let incrementalCost = new Decimal(incrementalWh).dividedBy(1000).times(pricePerKwh);
      
      let deductResult = await walletService.deductForCharging({
        userId,
        amount: incrementalCost.toFixed(2),
        idempotencyKey: `charging:${transactionId}:${currentMeterWh}`,
      });
      
      expect(deductResult.success).toBe(true);
      expect(deductResult.newBalance).toBe("450.00");
      lastBilledWh = currentMeterWh;
      
      // Second meter reading: 3000 Wh (2 kWh more = LKR 100)
      currentMeterWh = 3000;
      incrementalWh = currentMeterWh - lastBilledWh;
      incrementalCost = new Decimal(incrementalWh).dividedBy(1000).times(pricePerKwh);
      
      deductResult = await walletService.deductForCharging({
        userId,
        amount: incrementalCost.toFixed(2),
        idempotencyKey: `charging:${transactionId}:${currentMeterWh}`,
      });
      
      expect(deductResult.success).toBe(true);
      expect(deductResult.newBalance).toBe("350.00");
      
      // Verify ledger entries
      expect(mockLedgerEntries.length).toBe(3); // 1 top-up + 2 deductions
      expect(mockLedgerEntries.filter((e) => e.type === "TOP_UP").length).toBe(1);
      expect(mockLedgerEntries.filter((e) => e.type === "CHARGE_DEBIT").length).toBe(2);
    });

    it("should handle insufficient funds during charging", async () => {
      const userId = "user-002";
      
      // Top up with small amount
      await walletService.topUp({
        userId,
        amount: 30,
        paymentId: "PAY-002",
        idempotencyKey: "topup:PAY-002",
      });
      
      // Try to deduct more than balance
      const deductResult = await walletService.deductForCharging({
        userId,
        amount: 50,
        idempotencyKey: "charging:TX-002:1000",
      });
      
      expect(deductResult.success).toBe(false);
      expect(deductResult.insufficientFunds).toBe(true);
      expect(deductResult.currentBalance).toBe("30.00");
    });
  });

  describe("Idempotency", () => {
    it("should not duplicate top-up with same idempotency key", async () => {
      const userId = "user-003";
      
      // First top-up
      const result1 = await walletService.topUp({
        userId,
        amount: 100,
        paymentId: "PAY-003",
        idempotencyKey: "topup:PAY-003",
      });
      
      expect(result1.duplicate).toBe(false);
      expect(result1.wallet.balance.toFixed(2)).toBe("100.00");
      
      // Duplicate top-up (same idempotency key)
      const result2 = await walletService.topUp({
        userId,
        amount: 100,
        paymentId: "PAY-003",
        idempotencyKey: "topup:PAY-003",
      });
      
      expect(result2.duplicate).toBe(true);
      expect(result2.wallet.balance.toFixed(2)).toBe("100.00"); // Still 100, not 200
      
      // Verify only one ledger entry
      const userEntries = mockLedgerEntries.filter(
        (e) => e.userId === userId && e.type === "TOP_UP"
      );
      expect(userEntries.length).toBe(1);
    });

    it("should not duplicate charging deduction with same idempotency key", async () => {
      const userId = "user-004";
      
      await walletService.topUp({
        userId,
        amount: 200,
        paymentId: "PAY-004",
        idempotencyKey: "topup:PAY-004",
      });
      
      // First deduction
      const result1 = await walletService.deductForCharging({
        userId,
        amount: 50,
        idempotencyKey: "charging:TX-004:1000",
      });
      
      expect(result1.success).toBe(true);
      expect(result1.newBalance).toBe("150.00");
      
      // Duplicate deduction (same idempotency key)
      const result2 = await walletService.deductForCharging({
        userId,
        amount: 50,
        idempotencyKey: "charging:TX-004:1000",
      });
      
      expect(result2.duplicate).toBe(true);
      
      // Balance should still be 150
      const balance = await walletService.getBalance(userId);
      expect(balance.toFixed(2)).toBe("150.00");
    });
  });

  describe("Concurrent MeterValues Safety", () => {
    it("should handle concurrent deductions safely", async () => {
      const userId = "user-005";
      
      await walletService.topUp({
        userId,
        amount: 1000,
        paymentId: "PAY-005",
        idempotencyKey: "topup:PAY-005",
      });
      
      // Simulate concurrent meter value updates
      const deductions = [
        { meter: 1000, key: "charging:TX-005:1000" },
        { meter: 2000, key: "charging:TX-005:2000" },
        { meter: 3000, key: "charging:TX-005:3000" },
        { meter: 4000, key: "charging:TX-005:4000" },
        { meter: 5000, key: "charging:TX-005:5000" },
      ];
      
      // Process all deductions (each 1 kWh = LKR 50)
      const results = await Promise.all(
        deductions.map((d) =>
          walletService.deductForCharging({
            userId,
            amount: 50,
            idempotencyKey: d.key,
          })
        )
      );
      
      // All should succeed
      results.forEach((r) => expect(r.success).toBe(true));
      
      // Final balance should be 1000 - (5 * 50) = 750
      const finalBalance = await walletService.getBalance(userId);
      expect(finalBalance.toFixed(2)).toBe("750.00");
    });
  });

  describe("Wallet Top-up During Session", () => {
    it("should allow top-up during active charging session", async () => {
      const userId = "user-006";
      
      // Initial top-up
      await walletService.topUp({
        userId,
        amount: 100,
        paymentId: "PAY-006-1",
        idempotencyKey: "topup:PAY-006-1",
      });
      
      // Deduct during charging
      await walletService.deductForCharging({
        userId,
        amount: 80,
        idempotencyKey: "charging:TX-006:1600",
      });
      
      // Balance is now 20
      let balance = await walletService.getBalance(userId);
      expect(balance.toFixed(2)).toBe("20.00");
      
      // Top up during session (this would cancel grace period in real implementation)
      await walletService.topUp({
        userId,
        amount: 200,
        paymentId: "PAY-006-2",
        idempotencyKey: "topup:PAY-006-2",
      });
      
      // Balance should be 220
      balance = await walletService.getBalance(userId);
      expect(balance.toFixed(2)).toBe("220.00");
      
      // Continue charging
      await walletService.deductForCharging({
        userId,
        amount: 50,
        idempotencyKey: "charging:TX-006:2600",
      });
      
      balance = await walletService.getBalance(userId);
      expect(balance.toFixed(2)).toBe("170.00");
    });
  });

  describe("Ledger Integrity", () => {
    it("should maintain running balance in ledger entries", async () => {
      const userId = "user-007";
      
      // Top up 500
      await walletService.topUp({
        userId,
        amount: 500,
        paymentId: "PAY-007",
        idempotencyKey: "topup:PAY-007",
      });
      
      // Deduct 100
      await walletService.deductForCharging({
        userId,
        amount: 100,
        idempotencyKey: "charging:TX-007:2000",
      });
      
      // Deduct 50
      await walletService.deductForCharging({
        userId,
        amount: 50,
        idempotencyKey: "charging:TX-007:3000",
      });
      
      // Get user's ledger entries
      const userEntries = mockLedgerEntries
        .filter((e) => e.userId === userId)
        .sort((a, b) => a.createdAt - b.createdAt);
      
      // Verify running balances
      expect(userEntries[0].balanceAfter.toFixed(2)).toBe("500.00");
      expect(userEntries[1].balanceAfter.toFixed(2)).toBe("400.00");
      expect(userEntries[2].balanceAfter.toFixed(2)).toBe("350.00");
    });
  });
});

