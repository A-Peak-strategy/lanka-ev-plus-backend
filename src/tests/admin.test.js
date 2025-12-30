import { jest } from "@jest/globals";
import Decimal from "decimal.js";

// Mock Prisma
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  charger: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  connector: {
    create: jest.fn(),
  },
  station: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  pricing: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  chargingSession: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
  ocppMessageLog: {
    findMany: jest.fn(),
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  adminAuditLog: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
};

jest.unstable_mockModule("../config/db.js", () => ({
  default: mockPrisma,
}));

// Import after mocking
const adminService = await import("../services/admin.service.js");

describe("Admin Service - Owner Management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createOwner", () => {
    it("should create an owner with wallet", async () => {
      mockPrisma.user.create.mockResolvedValue({
        id: "owner-1",
        email: "owner@test.com",
        role: "OWNER",
        firebaseUid: "firebase-123",
      });
      mockPrisma.wallet.create.mockResolvedValue({ id: "wallet-1" });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      const result = await adminService.createOwner(
        {
          email: "owner@test.com",
          name: "Test Owner",
          firebaseUid: "firebase-123",
        },
        "admin-1"
      );

      expect(result.role).toBe("OWNER");
      expect(mockPrisma.wallet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "owner-1",
          balance: 0,
          currency: "LKR",
        }),
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalled();
    });

    it("should require email or phone", async () => {
      await expect(
        adminService.createOwner({ firebaseUid: "firebase-123" }, "admin-1")
      ).rejects.toThrow("Email or phone is required");
    });

    it("should require firebaseUid", async () => {
      await expect(
        adminService.createOwner({ email: "owner@test.com" }, "admin-1")
      ).rejects.toThrow("Firebase UID is required");
    });
  });

  describe("updateUserStatus", () => {
    it("should activate a user", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        isActive: false,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "user-1",
        isActive: true,
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      const result = await adminService.updateUserStatus("user-1", true, "admin-1");

      expect(result.isActive).toBe(true);
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "ACTIVATE_USER",
        }),
      });
    });

    it("should deactivate a user", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        isActive: true,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "user-1",
        isActive: false,
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      const result = await adminService.updateUserStatus("user-1", false, "admin-1");

      expect(result.isActive).toBe(false);
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "DEACTIVATE_USER",
        }),
      });
    });
  });
});

describe("Admin Service - Charger Management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("registerCharger", () => {
    it("should register a charger with serial number", async () => {
      mockPrisma.charger.findFirst.mockResolvedValue(null);
      mockPrisma.charger.create.mockResolvedValue({
        id: "CP001",
        serialNumber: "SN-12345",
        isRegistered: true,
      });
      mockPrisma.connector.create.mockResolvedValue({ id: "conn-1" });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      const result = await adminService.registerCharger(
        {
          id: "CP001",
          serialNumber: "SN-12345",
          numberOfConnectors: 2,
        },
        "admin-1"
      );

      expect(result.serialNumber).toBe("SN-12345");
      expect(result.isRegistered).toBe(true);
      expect(mockPrisma.connector.create).toHaveBeenCalledTimes(2);
    });

    it("should reject duplicate serial numbers", async () => {
      mockPrisma.charger.findFirst.mockResolvedValue({
        id: "existing",
        serialNumber: "SN-12345",
      });

      await expect(
        adminService.registerCharger({ serialNumber: "SN-12345" }, "admin-1")
      ).rejects.toThrow("already exists");
    });

    it("should require serial number", async () => {
      await expect(
        adminService.registerCharger({ id: "CP001" }, "admin-1")
      ).rejects.toThrow("Serial number is required");
    });
  });

  describe("assignChargerToStation", () => {
    it("should assign charger to station", async () => {
      mockPrisma.charger.findUnique.mockResolvedValue({ id: "CP001" });
      mockPrisma.station.findUnique.mockResolvedValue({ id: "station-1" });
      mockPrisma.charger.update.mockResolvedValue({
        id: "CP001",
        stationId: "station-1",
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      const result = await adminService.assignChargerToStation(
        "CP001",
        "station-1",
        "admin-1"
      );

      expect(result.stationId).toBe("station-1");
    });
  });
});

describe("Admin Service - Station Management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createStation", () => {
    it("should create a station for an owner", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "owner-1",
        role: "OWNER",
      });
      mockPrisma.station.create.mockResolvedValue({
        id: "station-1",
        name: "Test Station",
        ownerId: "owner-1",
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      const result = await adminService.createStation(
        {
          name: "Test Station",
          address: "123 Main St",
          latitude: 6.9271,
          longitude: 79.8612,
          ownerId: "owner-1",
        },
        "admin-1"
      );

      expect(result.name).toBe("Test Station");
      expect(result.ownerId).toBe("owner-1");
    });

    it("should reject non-owner users", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        role: "CONSUMER",
      });

      await expect(
        adminService.createStation({ ownerId: "user-1" }, "admin-1")
      ).rejects.toThrow("not a station owner");
    });
  });

  describe("assignStationToOwner", () => {
    it("should reassign station to new owner", async () => {
      mockPrisma.station.findUnique.mockResolvedValue({
        id: "station-1",
        ownerId: "owner-1",
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "owner-2",
        role: "OWNER",
      });
      mockPrisma.station.update.mockResolvedValue({
        id: "station-1",
        ownerId: "owner-2",
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      const result = await adminService.assignStationToOwner(
        "station-1",
        "owner-2",
        "admin-1"
      );

      expect(result.ownerId).toBe("owner-2");
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousValue: { ownerId: "owner-1" },
          newValue: { ownerId: "owner-2" },
        }),
      });
    });
  });
});

describe("Admin Service - Pricing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createPricing", () => {
    it("should create pricing with 2% default commission", async () => {
      mockPrisma.pricing.create.mockResolvedValue({
        id: "pricing-1",
        name: "Standard",
        pricePerKwh: 50.0,
        commissionRate: 2.0,
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      const result = await adminService.createPricing(
        {
          name: "Standard",
          pricePerKwh: 50.0,
        },
        "admin-1"
      );

      expect(mockPrisma.pricing.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          commissionRate: 2.0, // Default 2%
        }),
      });
    });

    it("should unset existing default when setting new default", async () => {
      mockPrisma.pricing.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.pricing.create.mockResolvedValue({
        id: "pricing-1",
        isDefault: true,
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      await adminService.createPricing(
        {
          name: "New Default",
          pricePerKwh: 50.0,
          isDefault: true,
        },
        "admin-1"
      );

      expect(mockPrisma.pricing.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  describe("updatePricing", () => {
    it("should log previous and new values", async () => {
      mockPrisma.pricing.findUnique.mockResolvedValue({
        id: "pricing-1",
        pricePerKwh: 50.0,
        gracePeriodSec: 60,
      });
      mockPrisma.pricing.update.mockResolvedValue({
        id: "pricing-1",
        pricePerKwh: 55.0,
        gracePeriodSec: 90,
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({ id: "log-1" });

      await adminService.updatePricing(
        "pricing-1",
        { pricePerKwh: 55.0, gracePeriodSec: 90 },
        "admin-1"
      );

      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "UPDATE_PRICING",
          previousValue: expect.objectContaining({
            pricePerKwh: 50.0,
          }),
          newValue: expect.objectContaining({
            pricePerKwh: 55.0,
          }),
        }),
      });
    });
  });
});

describe("Admin Service - Session Monitoring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getSessions", () => {
    it("should filter active sessions", async () => {
      mockPrisma.chargingSession.findMany.mockResolvedValue([
        { id: 1, transactionId: "tx-1", endedAt: null },
      ]);

      await adminService.getSessions({ active: true });

      expect(mockPrisma.chargingSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            endedAt: null,
          }),
        })
      );
    });

    it("should filter by owner", async () => {
      mockPrisma.chargingSession.findMany.mockResolvedValue([]);

      await adminService.getSessions({ ownerId: "owner-1" });

      expect(mockPrisma.chargingSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            charger: expect.objectContaining({
              station: { ownerId: "owner-1" },
            }),
          }),
        })
      );
    });
  });

  describe("getSessionStats", () => {
    it("should aggregate session statistics", async () => {
      mockPrisma.chargingSession.findMany.mockResolvedValue([
        {
          energyUsedWh: 10000,
          totalCost: new Decimal("500.00"),
          ownerEarning: new Decimal("490.00"),
          commission: new Decimal("10.00"),
        },
        {
          energyUsedWh: 20000,
          totalCost: new Decimal("1000.00"),
          ownerEarning: new Decimal("980.00"),
          commission: new Decimal("20.00"),
        },
      ]);

      const stats = await adminService.getSessionStats({});

      expect(stats.sessionCount).toBe(2);
      expect(stats.totalEnergyKwh).toBe("30.00");
      expect(stats.totalRevenue).toBe("1500.00");
    });
  });
});

describe("Admin Service - Audit Logs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should retrieve audit logs with filters", async () => {
    mockPrisma.adminAuditLog.findMany.mockResolvedValue([
      {
        id: "log-1",
        adminId: "admin-1",
        action: "CREATE_OWNER",
        createdAt: new Date(),
      },
    ]);

    await adminService.getAuditLogs({
      action: "CREATE_OWNER",
      limit: 10,
    });

    expect(mockPrisma.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: "CREATE_OWNER",
        }),
        take: 10,
      })
    );
  });
});

