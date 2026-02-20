import { jest } from "@jest/globals";
import Decimal from "decimal.js";

// Mock Prisma
const mockPrisma = {
  ledger: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

// Mock the module before importing
jest.unstable_mockModule("../../src/config/db.js", () => ({
  default: mockPrisma,
}));

// Import after mocking
const ledgerService = await import("../../src/services/ledger.service.js");

describe("Ledger Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("LedgerType enum", () => {
    it("should have all required ledger types", () => {
      expect(ledgerService.LedgerType.TOP_UP).toBe("TOP_UP");
      expect(ledgerService.LedgerType.CHARGE_DEBIT).toBe("CHARGE_DEBIT");
      expect(ledgerService.LedgerType.REFUND).toBe("REFUND");
      expect(ledgerService.LedgerType.OWNER_EARNING).toBe("OWNER_EARNING");
      expect(ledgerService.LedgerType.COMMISSION).toBe("COMMISSION");
      expect(ledgerService.LedgerType.SETTLEMENT_PAYOUT).toBe("SETTLEMENT_PAYOUT");
    });
  });

  describe("createLedgerEntry", () => {
    it("should throw error if required fields are missing", async () => {
      await expect(
        ledgerService.createLedgerEntry({})
      ).rejects.toThrow("Missing required ledger entry fields");

      await expect(
        ledgerService.createLedgerEntry({
          userId: "user-123",
          type: "TOP_UP",
          // missing amount and balanceAfter
        })
      ).rejects.toThrow("Missing required ledger entry fields");
    });

    it("should throw error if idempotency key is missing", async () => {
      await expect(
        ledgerService.createLedgerEntry({
          userId: "user-123",
          type: "TOP_UP",
          amount: 100,
          balanceAfter: 100,
          // missing idempotencyKey
        })
      ).rejects.toThrow("Idempotency key is required");
    });

    it("should return existing entry if duplicate idempotency key", async () => {
      const existingEntry = {
        id: "ledger-123",
        userId: "user-123",
        type: "TOP_UP",
        amount: new Decimal("100.00"),
        idempotencyKey: "key-123",
      };

      mockPrisma.ledger.findUnique.mockResolvedValue(existingEntry);

      const result = await ledgerService.createLedgerEntry(
        {
          userId: "user-123",
          type: "TOP_UP",
          amount: 100,
          balanceAfter: 100,
          idempotencyKey: "key-123",
        },
        mockPrisma
      );

      expect(result.duplicate).toBe(true);
      expect(result.entry).toEqual(existingEntry);
      expect(mockPrisma.ledger.create).not.toHaveBeenCalled();
    });

    it("should create new ledger entry", async () => {
      mockPrisma.ledger.findUnique.mockResolvedValue(null);

      const newEntry = {
        id: "ledger-new",
        userId: "user-123",
        type: "TOP_UP",
        amount: new Decimal("100.00"),
        balanceAfter: new Decimal("100.00"),
        idempotencyKey: "new-key",
      };

      mockPrisma.ledger.create.mockResolvedValue(newEntry);

      const result = await ledgerService.createLedgerEntry(
        {
          userId: "user-123",
          type: "TOP_UP",
          amount: 100,
          balanceAfter: 100,
          referenceId: "payment-123",
          referenceType: "PAYMENT",
          description: "Test top-up",
          idempotencyKey: "new-key",
          metadata: { test: true },
        },
        mockPrisma
      );

      expect(result.duplicate).toBe(false);
      expect(result.entry).toEqual(newEntry);
      expect(mockPrisma.ledger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-123",
          type: "TOP_UP",
          amount: "100.00",
          balanceAfter: "100.00",
          referenceId: "payment-123",
          idempotencyKey: "new-key",
        }),
      });
    });
  });

  describe("generateIdempotencyKey", () => {
    it("should generate consistent idempotency keys", () => {
      const key1 = ledgerService.generateIdempotencyKey("charging", "tx-123", "1000");
      const key2 = ledgerService.generateIdempotencyKey("charging", "tx-123", "1000");

      expect(key1).toBe(key2);
      expect(key1).toBe("charging:tx-123:1000");
    });

    it("should generate different keys for different inputs", () => {
      const key1 = ledgerService.generateIdempotencyKey("charging", "tx-123", "1000");
      const key2 = ledgerService.generateIdempotencyKey("charging", "tx-123", "2000");

      expect(key1).not.toBe(key2);
    });
  });

  describe("getLedgerEntries", () => {
    it("should query ledger entries with filters", async () => {
      const mockEntries = [
        { id: "1", type: "TOP_UP", amount: new Decimal("100.00") },
        { id: "2", type: "TOP_UP", amount: new Decimal("200.00") },
      ];

      mockPrisma.ledger.findMany.mockResolvedValue(mockEntries);

      const entries = await ledgerService.getLedgerEntries("user-123", {
        type: "TOP_UP",
        limit: 10,
        offset: 0,
      });

      expect(entries).toEqual(mockEntries);
      expect(mockPrisma.ledger.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          type: "TOP_UP",
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        skip: 0,
      });
    });

    it("should support date range filters", async () => {
      mockPrisma.ledger.findMany.mockResolvedValue([]);

      const startDate = "2024-01-01";
      const endDate = "2024-12-31";

      await ledgerService.getLedgerEntries("user-123", {
        startDate,
        endDate,
      });

      expect(mockPrisma.ledger.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          createdAt: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        skip: 0,
      });
    });
  });

  describe("getRunningBalance", () => {
    it("should return balance from last ledger entry", async () => {
      mockPrisma.ledger.findFirst.mockResolvedValue({
        balanceAfter: { toString: () => "250.50" },
      });

      const balance = await ledgerService.getRunningBalance("user-123");

      expect(balance).toBe("250.50");
    });

    it("should return 0.00 if no entries exist", async () => {
      mockPrisma.ledger.findFirst.mockResolvedValue(null);

      const balance = await ledgerService.getRunningBalance("user-123");

      expect(balance).toBe("0.00");
    });
  });

  describe("reconcileBalance", () => {
    it("should detect balance discrepancy", async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        balance: { toString: () => "100.00" },
      });

      mockPrisma.ledger.findFirst.mockResolvedValue({
        balanceAfter: { toString: () => "95.00" },
      });

      const result = await ledgerService.reconcileBalance("user-123");

      expect(result.isReconciled).toBe(false);
      expect(result.walletBalance).toBe("100.00");
      expect(result.ledgerBalance).toBe("95.00");
      expect(result.discrepancy).toBe("5.00");
    });

    it("should confirm balanced reconciliation", async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        balance: { toString: () => "100.00" },
      });

      mockPrisma.ledger.findFirst.mockResolvedValue({
        balanceAfter: { toString: () => "100.00" },
      });

      const result = await ledgerService.reconcileBalance("user-123");

      expect(result.isReconciled).toBe(true);
      expect(result.discrepancy).toBe("0.00");
    });
  });

  describe("Immutability", () => {
    it("should NOT have any update methods", () => {
      // Ledger entries should never be updated
      // This test ensures the service doesn't expose update functionality
      expect(ledgerService.updateLedgerEntry).toBeUndefined();
      expect(ledgerService.deleteLedgerEntry).toBeUndefined();
    });
  });
});

