import { jest } from "@jest/globals";
import Decimal from "decimal.js";

// Mock Prisma
const mockPrisma = {
  wallet: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  ledger: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

// Mock the modules before importing
jest.unstable_mockModule("../../src/config/db.js", () => ({
  default: mockPrisma,
}));

jest.unstable_mockModule("../../src/services/ledger.service.js", () => ({
  createLedgerEntry: jest.fn(),
  LedgerType: {
    TOP_UP: "TOP_UP",
    CHARGE_DEBIT: "CHARGE_DEBIT",
    REFUND: "REFUND",
  },
}));

// Import after mocking
const { default: walletService } = await import("../../src/services/wallet.service.js");

describe("Wallet Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getOrCreateWallet", () => {
    it("should return existing wallet if found", async () => {
      const mockWallet = {
        id: "wallet-123",
        userId: "user-123",
        balance: new Decimal("100.00"),
        currency: "LKR",
        version: 0,
      };

      mockPrisma.wallet.findUnique.mockResolvedValue(mockWallet);

      const wallet = await walletService.getOrCreateWallet("user-123");

      expect(wallet).toEqual(mockWallet);
      expect(mockPrisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { userId: "user-123" },
      });
      expect(mockPrisma.wallet.create).not.toHaveBeenCalled();
    });

    it("should create new wallet if not found", async () => {
      const mockWallet = {
        id: "wallet-new",
        userId: "user-456",
        balance: new Decimal("0.00"),
        currency: "LKR",
        version: 0,
      };

      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue(mockWallet);

      const wallet = await walletService.getOrCreateWallet("user-456");

      expect(wallet).toEqual(mockWallet);
      expect(mockPrisma.wallet.create).toHaveBeenCalledWith({
        data: {
          userId: "user-456",
          balance: 0,
          currency: "LKR",
        },
      });
    });
  });

  describe("getBalance", () => {
    it("should return balance as Decimal", async () => {
      const mockWallet = {
        id: "wallet-123",
        userId: "user-123",
        balance: { toString: () => "250.50" },
      };

      mockPrisma.wallet.findUnique.mockResolvedValue(mockWallet);

      const balance = await walletService.getBalance("user-123");

      expect(balance.toString()).toBe("250.5");
      expect(balance instanceof Decimal).toBe(true);
    });
  });

  describe("topUp", () => {
    it("should reject zero or negative amount", async () => {
      await expect(
        walletService.topUp({
          userId: "user-123",
          amount: 0,
          paymentId: "pay-123",
          idempotencyKey: "key-123",
        })
      ).rejects.toThrow("Top-up amount must be positive");

      await expect(
        walletService.topUp({
          userId: "user-123",
          amount: -100,
          paymentId: "pay-123",
          idempotencyKey: "key-123",
        })
      ).rejects.toThrow("Top-up amount must be positive");
    });

    it("should return existing entry if duplicate idempotency key", async () => {
      const existingEntry = {
        id: "ledger-123",
        userId: "user-123",
        type: "TOP_UP",
        amount: new Decimal("100.00"),
      };

      mockPrisma.ledger.findUnique.mockResolvedValue(existingEntry);
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: "wallet-123",
        balance: new Decimal("200.00"),
      });

      const result = await walletService.topUp({
        userId: "user-123",
        amount: 100,
        paymentId: "pay-123",
        idempotencyKey: "duplicate-key",
      });

      expect(result.duplicate).toBe(true);
      expect(result.ledgerEntry).toEqual(existingEntry);
    });

    it("should process top-up with optimistic locking", async () => {
      mockPrisma.ledger.findUnique.mockResolvedValue(null);

      const mockWallet = {
        id: "wallet-123",
        userId: "user-123",
        balance: { toString: () => "100.00" },
        version: 5,
      };

      const updatedWallet = {
        ...mockWallet,
        balance: { toString: () => "200.00" },
        version: 6,
      };

      const ledgerEntry = {
        id: "ledger-new",
        userId: "user-123",
        type: "TOP_UP",
        amount: { toString: () => "100.00" },
        balanceAfter: { toString: () => "200.00" },
      };

      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue(mockWallet),
            update: jest.fn().mockResolvedValue(updatedWallet),
          },
          ledger: {
            create: jest.fn().mockResolvedValue(ledgerEntry),
          },
        };
        return fn(tx);
      });

      const result = await walletService.topUp({
        userId: "user-123",
        amount: 100,
        paymentId: "pay-456",
        idempotencyKey: "unique-key",
      });

      expect(result.duplicate).toBe(false);
      expect(result.wallet).toEqual(updatedWallet);
      expect(result.ledgerEntry).toEqual(ledgerEntry);
    });
  });

  describe("deductForCharging", () => {
    it("should skip zero amount deduction", async () => {
      const result = await walletService.deductForCharging({
        userId: "user-123",
        amount: 0,
        transactionId: "tx-123",
        idempotencyKey: "key-123",
        energyWh: 0,
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it("should return insufficient funds when balance is low", async () => {
      mockPrisma.ledger.findUnique.mockResolvedValue(null);

      const mockWallet = {
        id: "wallet-123",
        userId: "user-123",
        balance: { toString: () => "10.00" },
        version: 1,
      };

      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue(mockWallet),
          },
        };
        return fn(tx);
      });

      const result = await walletService.deductForCharging({
        userId: "user-123",
        amount: 50,
        transactionId: "tx-123",
        idempotencyKey: "key-123",
        energyWh: 1000,
      });

      expect(result.success).toBe(false);
      expect(result.insufficientFunds).toBe(true);
      expect(result.currentBalance).toBe("10.00");
      expect(result.shortfall).toBe("40.00");
    });

    it("should process successful deduction", async () => {
      mockPrisma.ledger.findUnique.mockResolvedValue(null);

      const mockWallet = {
        id: "wallet-123",
        userId: "user-123",
        balance: { toString: () => "100.00" },
        version: 1,
      };

      const updatedWallet = {
        ...mockWallet,
        balance: { toString: () => "50.00" },
        version: 2,
      };

      const ledgerEntry = {
        id: "ledger-new",
        type: "CHARGE_DEBIT",
        amount: { toString: () => "50.00" },
      };

      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue(mockWallet),
            update: jest.fn().mockResolvedValue(updatedWallet),
          },
          ledger: {
            create: jest.fn().mockResolvedValue(ledgerEntry),
          },
        };
        return fn(tx);
      });

      const result = await walletService.deductForCharging({
        userId: "user-123",
        amount: 50,
        transactionId: "tx-123",
        idempotencyKey: "key-123",
        energyWh: 1000,
      });

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe("50.00");
    });
  });

  describe("checkSufficientBalance", () => {
    it("should return true when balance is sufficient", async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        balance: { toString: () => "100.00" },
      });

      const result = await walletService.checkSufficientBalance("user-123", 50);

      expect(result.sufficient).toBe(true);
      expect(result.shortfall).toBe("0.00");
    });

    it("should return false when balance is insufficient", async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        balance: { toString: () => "30.00" },
      });

      const result = await walletService.checkSufficientBalance("user-123", 50);

      expect(result.sufficient).toBe(false);
      expect(result.shortfall).toBe("20.00");
    });
  });
});

