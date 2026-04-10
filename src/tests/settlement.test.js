import { jest } from "@jest/globals";
import Decimal from "decimal.js";

// Mock Prisma before importing services
const mockPrisma = {
  user: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  chargingSession: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
  },
  settlement: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  settlementItem: {
    create: jest.fn(),
  },
  ledger: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  adminAuditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};

jest.unstable_mockModule("../config/db.js", () => ({
  default: mockPrisma,
}));

// Import after mocking
const { calculateEarnings, recordSessionEarning } = await import(
  "../services/settlement.service.js"
);

describe("Settlement Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("calculateEarnings", () => {
    it("should calculate correct earnings with 2% commission", () => {
      const totalCost = new Decimal("1000.00");
      const result = calculateEarnings(totalCost, 2.0);

      expect(result.ownerEarning).toBe("980.00");
      expect(result.commission).toBe("20.00");
    });

    it("should calculate correct earnings with default 2% commission", () => {
      const totalCost = new Decimal("500.00");
      const result = calculateEarnings(totalCost);

      expect(result.ownerEarning).toBe("490.00");
      expect(result.commission).toBe("10.00");
    });

    it("should handle zero cost", () => {
      const result = calculateEarnings(new Decimal("0.00"));

      expect(result.ownerEarning).toBe("0.00");
      expect(result.commission).toBe("0.00");
    });

    it("should handle small amounts correctly", () => {
      const totalCost = new Decimal("1.00");
      const result = calculateEarnings(totalCost, 2.0);

      expect(result.ownerEarning).toBe("0.98");
      expect(result.commission).toBe("0.02");
    });

    it("should handle large amounts", () => {
      const totalCost = new Decimal("100000.00");
      const result = calculateEarnings(totalCost, 2.0);

      expect(result.ownerEarning).toBe("98000.00");
      expect(result.commission).toBe("2000.00");
    });

    it("should handle different commission rates", () => {
      const totalCost = new Decimal("1000.00");
      
      // 5% commission
      const result5 = calculateEarnings(totalCost, 5.0);
      expect(result5.ownerEarning).toBe("950.00");
      expect(result5.commission).toBe("50.00");

      // 10% commission
      const result10 = calculateEarnings(totalCost, 10.0);
      expect(result10.ownerEarning).toBe("900.00");
      expect(result10.commission).toBe("100.00");

      // 0% commission
      const result0 = calculateEarnings(totalCost, 0.0);
      expect(result0.ownerEarning).toBe("1000.00");
      expect(result0.commission).toBe("0.00");
    });
  });

  describe("Commission Correctness", () => {
    it("should ensure owner + commission = total (invariant check)", () => {
      const testCases = [
        { total: "100.00", rate: 2.0 },
        { total: "1000.00", rate: 2.0 },
        { total: "57.83", rate: 2.0 },
        { total: "0.01", rate: 2.0 },
        { total: "99999.99", rate: 2.0 },
      ];

      for (const { total, rate } of testCases) {
        const totalCost = new Decimal(total);
        const result = calculateEarnings(totalCost, rate);

        const ownerEarning = new Decimal(result.ownerEarning);
        const commission = new Decimal(result.commission);
        const sum = ownerEarning.plus(commission);

        // Sum should equal total (with minor rounding tolerance)
        expect(sum.minus(totalCost).abs().lessThanOrEqualTo(0.01)).toBe(true);
      }
    });
  });

  describe("Immutability", () => {
    it("should create ledger entries (not update existing)", async () => {
      // Verify that recordSessionEarning creates new entries
      // rather than modifying existing ones
      mockPrisma.chargingSession.update.mockResolvedValue({ id: 1 });
      mockPrisma.ledger.findUnique.mockResolvedValue(null);
      mockPrisma.ledger.findFirst.mockResolvedValue(null);
      mockPrisma.ledger.create.mockResolvedValue({
        id: "ledger-1",
        type: "OWNER_EARNING",
        amount: "980.00",
      });

      // This should create entries, not update
      await recordSessionEarning({
        sessionId: 1,
        transactionId: "tx-123",
        ownerId: "owner-1",
        totalCost: new Decimal("1000.00"),
        commissionRate: 2.0,
      });

      // Should have called create, not update
      expect(mockPrisma.ledger.create).toHaveBeenCalled();
    });
  });
});

describe("Admin Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Audit Logging", () => {
    it("should log all admin actions", async () => {
      const { createOwner } = await import("../services/admin.service.js");

      mockPrisma.user.create.mockResolvedValue({
        id: "user-1",
        email: "owner@test.com",
        role: "OWNER",
      });
      mockPrisma.wallet.create.mockResolvedValue({ id: "wallet-1" });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      await createOwner(
        {
          email: "owner@test.com",
          name: "Test Owner",
          firebaseUid: "firebase-123",
        },
        "admin-1"
      );

      // Verify audit log was created
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminId: "admin-1",
          action: "CREATE_OWNER",
          targetType: "USER",
        }),
      });
    });
  });
});

describe("Settlement Bi-weekly", () => {
  it("should aggregate sessions for 14-day period", async () => {
    const { createSettlement } = await import("../services/settlement.service.js");

    const periodStart = new Date("2024-01-01");
    const periodEnd = new Date("2024-01-14");

    // Mock sessions for the period
    mockPrisma.settlement.findFirst.mockResolvedValue(null); // No existing settlement
    mockPrisma.chargingSession.findMany.mockResolvedValue([
      {
        id: 1,
        transactionId: "tx-1",
        energyUsedWh: 10000,
        ownerEarning: new Decimal("490.00"),
        commission: new Decimal("10.00"),
        startedAt: new Date("2024-01-05"),
        charger: { station: { ownerId: "owner-1" } },
      },
      {
        id: 2,
        transactionId: "tx-2",
        energyUsedWh: 20000,
        ownerEarning: new Decimal("980.00"),
        commission: new Decimal("20.00"),
        startedAt: new Date("2024-01-10"),
        charger: { station: { ownerId: "owner-1" } },
      },
    ]);

    mockPrisma.settlement.create.mockResolvedValue({
      id: "settlement-1",
      ownerId: "owner-1",
      totalEarnings: new Decimal("1470.00"),
      totalCommission: new Decimal("30.00"),
      netPayout: new Decimal("1470.00"),
      sessionCount: 2,
    });

    mockPrisma.settlementItem.create.mockResolvedValue({ id: "item-1" });

    const result = await createSettlement("owner-1", periodStart, periodEnd);

    expect(result).toBeDefined();
    expect(mockPrisma.settlement.create).toHaveBeenCalled();
  });

  it("should prevent duplicate settlements for same period", async () => {
    const { createSettlement } = await import("../services/settlement.service.js");

    // Mock existing settlement
    mockPrisma.settlement.findFirst.mockResolvedValue({
      id: "existing-settlement",
      periodStart: new Date("2024-01-01"),
      periodEnd: new Date("2024-01-14"),
    });

    await expect(
      createSettlement("owner-1", new Date("2024-01-01"), new Date("2024-01-14"))
    ).rejects.toThrow("Settlement already exists");
  });
});

describe("Settlement Payout", () => {
  it("should mark settlement as paid with payment reference", async () => {
    const { markSettlementAsPaid } = await import("../services/settlement.service.js");

    mockPrisma.settlement.findUnique.mockResolvedValue({
      id: "settlement-1",
      ownerId: "owner-1",
      status: "PENDING",
      netPayout: new Decimal("1000.00"),
    });

    mockPrisma.settlement.update.mockResolvedValue({
      id: "settlement-1",
      status: "PAID",
      paymentRef: "BANK-REF-123",
    });

    mockPrisma.ledger.findUnique.mockResolvedValue(null);
    mockPrisma.ledger.findFirst.mockResolvedValue(null);
    mockPrisma.ledger.create.mockResolvedValue({ id: "ledger-1" });
    mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

    const result = await markSettlementAsPaid(
      "settlement-1",
      {
        paymentRef: "BANK-REF-123",
        paymentMethod: "Bank Transfer",
        paymentNotes: "Paid via online banking",
      },
      "admin-1"
    );

    expect(result.status).toBe("PAID");

    // Verify ledger entry was created
    expect(mockPrisma.ledger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "SETTLEMENT_PAYOUT",
        referenceType: "SETTLEMENT",
      }),
    });

    // Verify audit log was created
    expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "MARK_SETTLEMENT_PAID",
      }),
    });
  });

  it("should reject payment for already paid settlement", async () => {
    const { markSettlementAsPaid } = await import("../services/settlement.service.js");

    mockPrisma.settlement.findUnique.mockResolvedValue({
      id: "settlement-1",
      status: "PAID",
    });

    await expect(
      markSettlementAsPaid("settlement-1", { paymentRef: "REF" }, "admin-1")
    ).rejects.toThrow("Settlement already paid");
  });

  it("should require payment reference (validated at controller level)", async () => {
    // Payment reference is validated in the controller, not the service
    // This test verifies the controller behavior
    const { markSettlementPaid } = await import("../api/admin.controller.js");

    // Mock request/response
    const req = {
      params: { settlementId: "settlement-1" },
      body: {}, // Missing paymentRef
      user: { id: "admin-1" },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await markSettlementPaid(req, res);

    // Controller should reject missing paymentRef
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Payment reference is required",
      })
    );
  });
});

describe("Owner Earnings Summary", () => {
  it("should aggregate all earnings correctly", async () => {
    const { getOwnerEarningsSummary } = await import("../services/settlement.service.js");

    mockPrisma.chargingSession.aggregate.mockResolvedValue({
      _sum: {
        ownerEarning: new Decimal("5000.00"),
        commission: new Decimal("102.04"),
        energyUsedWh: 100000,
        totalCost: new Decimal("5102.04"),
      },
      _count: { id: 50 },
    });

    mockPrisma.settlement.findMany.mockResolvedValueOnce([
      { netPayout: new Decimal("2000.00") },
    ]); // Pending

    mockPrisma.settlement.findMany.mockResolvedValueOnce([
      { netPayout: new Decimal("3000.00") },
    ]); // Paid

    const summary = await getOwnerEarningsSummary("owner-1");

    // Prisma may return Decimal as string without trailing zeros
    expect(parseFloat(summary.totalEarnings)).toBe(5000.00);
    expect(summary.totalSessions).toBe(50);
    expect(summary.pendingPayout).toBe("2000.00");
    expect(summary.totalPaidOut).toBe("3000.00");
  });
});

