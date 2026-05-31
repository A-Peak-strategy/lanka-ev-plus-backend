import { jest } from "@jest/globals";
import Decimal from "decimal.js";

// Mock Prisma and dependent services before importing the handlers
const mockPrisma = {
  user: {
    findFirst: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  chargingSession: {
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  connector: {
    findUnique: jest.fn(),
  },
  gracePeriodJob: {
    findUnique: jest.fn(),
  },
};

const mockChargerStore = {
  chargersStore: new Map(),
  getChargerKey: jest.fn((chargerId, connectorId) => `${chargerId}:${connectorId}`),
  getChargerState: jest.fn(),
  updateChargerState: jest.fn(),
};

const mockSessionService = {
  createSession: jest.fn(),
  updateSessionStatus: jest.fn(),
  finalizeSession: jest.fn(),
  getSessionByTransactionId: jest.fn(),
};

const mockBillingService = {
  getPricingForCharger: jest.fn(),
  processMeterValuesBilling: jest.fn(),
  finalizeSessionBilling: jest.fn(),
};

const mockBookingService = {
  validateBookingForStart: jest.fn(),
  markBookingUsed: jest.fn(),
};

const mockConnectorLockService = {
  markChargingActive: jest.fn(),
  markChargingComplete: jest.fn(),
};

const mockNotificationService = {
  sendChargingComplete: jest.fn(),
};

const mockOcppEvents = {
  emitSessionStarted: jest.fn(),
  emitSessionStopped: jest.fn(),
};

const mockMessageQueue = {
  sendCallResult: jest.fn(),
};

const mockRemoteStartCommand = {
  clearPendingStartWatchdog: jest.fn(),
  clearPendingStartState: jest.fn(),
};

const mockStatus = {
  ACCEPTED: "Accepted",
  BLOCKED: "Blocked",
};

jest.unstable_mockModule("../../src/config/db.js", () => ({
  default: mockPrisma,
}));

jest.unstable_mockModule("../../src/services/chargerStore.service.js", () => ({
  chargersStore: mockChargerStore.chargersStore,
  getChargerKey: mockChargerStore.getChargerKey,
  getChargerState: mockChargerStore.getChargerState,
  updateChargerState: mockChargerStore.updateChargerState,
}));

jest.unstable_mockModule("../../src/services/session.service.js", () => ({
  default: mockSessionService,
}));

jest.unstable_mockModule("../../src/services/billing.service.js", () => ({
  default: mockBillingService,
}));

jest.unstable_mockModule("../../src/services/booking.service.js", () => ({
  default: mockBookingService,
}));

jest.unstable_mockModule("../../src/services/connectorLock.service.js", () => ({
  default: mockConnectorLockService,
}));

jest.unstable_mockModule("../../src/services/notification.service.js", () => ({
  default: mockNotificationService,
}));

jest.unstable_mockModule("../../src/ocpp/messageQueue.js", () => ({
  sendCallResult: mockMessageQueue.sendCallResult,
}));

jest.unstable_mockModule("../../src/ocpp/ocppEvents.js", () => ({
  ocppEvents: mockOcppEvents,
}));

jest.unstable_mockModule("../../src/ocpp/commands/remoteStartTransaction.js", () => ({
  clearPendingStartWatchdog: mockRemoteStartCommand.clearPendingStartWatchdog,
  clearPendingStartState: mockRemoteStartCommand.clearPendingStartState,
}));

jest.unstable_mockModule("../../src/utils/generateTransactionId.js", () => ({
  generateTransactionId: jest.fn(() => "internal-tx-100"),
  initTransactionCounter: jest.fn(),
}));

// Import the handlers after mocks are registered
const { default: startTransaction } = await import("../../src/ocpp/handlers/startTransaction.js");
const { default: stopTransaction } = await import("../../src/ocpp/handlers/stopTransaction.js");

describe("OCPP Start/Stop Billing Flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChargerStore.chargersStore.clear();
    mockChargerStore.getChargerState.mockReset();
    mockChargerStore.updateChargerState.mockReset();
    mockPrisma.user.findFirst.mockReset();
    mockPrisma.wallet.findUnique.mockReset();
    mockPrisma.wallet.create.mockReset();
    mockPrisma.chargingSession.findUnique.mockReset();
    mockPrisma.chargingSession.count.mockReset();
    mockPrisma.chargingSession.update.mockReset();
    mockPrisma.connector.findUnique.mockReset();
    mockSessionService.createSession.mockReset();
    mockSessionService.updateSessionStatus.mockReset();
    mockSessionService.finalizeSession.mockReset();
    mockSessionService.getSessionByTransactionId.mockReset();
    mockBillingService.getPricingForCharger.mockReset();
    mockBillingService.processMeterValuesBilling.mockReset();
    mockBillingService.finalizeSessionBilling.mockReset();
    mockBookingService.validateBookingForStart.mockReset();
    mockBookingService.markBookingUsed.mockReset();
    mockConnectorLockService.markChargingActive.mockReset();
    mockConnectorLockService.markChargingComplete.mockReset();
    mockNotificationService.sendChargingComplete.mockReset();
    mockNotificationService.sendChargingComplete.mockResolvedValue();
    mockOcppEvents.emitSessionStarted.mockReset();
    mockOcppEvents.emitSessionStopped.mockReset();
    mockMessageQueue.sendCallResult.mockReset();
    mockRemoteStartCommand.clearPendingStartWatchdog.mockReset();
    mockRemoteStartCommand.clearPendingStartState.mockReset();
  });

  describe("startTransaction", () => {
    it("should create and start a charging session when authorization succeeds", async () => {
      const ws = {};
      const messageId = "msg-1";
      const chargerId = "charger-A";
      const payload = {
        connectorId: 1,
        idTag: "USER-ABC",
        meterStart: 1200,
        timestamp: new Date().toISOString(),
      };

      mockBillingService.getPricingForCharger.mockResolvedValue({ pricePerKwh: 50 });
      mockBookingService.validateBookingForStart.mockResolvedValue({ allowed: true, bookingId: null, type: "WALKIN" });
      mockConnectorLockService.markChargingActive.mockResolvedValue({ acquired: true });
      mockSessionService.createSession.mockResolvedValue({
        session: {
          id: 100,
          transactionId: "TX-100",
          meterStartWh: 1200,
        },
        duplicate: false,
      });

      mockChargerStore.chargersStore.set("charger-A:1", {
        pendingUserId: "user-1",
        pendingPresetAmount: "150.00",
      });

      await startTransaction(ws, messageId, chargerId, payload);

      expect(mockBillingService.getPricingForCharger).toHaveBeenCalledWith(chargerId);
      expect(mockSessionService.createSession).toHaveBeenCalledWith(expect.objectContaining({
        chargerId,
        connectorId: 1,
        transactionId: expect.any(String),
        idTag: "USER-ABC",
        userId: "user-1",
        meterStart: 1200,
        pricePerKwh: 50,
        presetAmount: "150.00",
      }));
      expect(mockRemoteStartCommand.clearPendingStartWatchdog).toHaveBeenCalledWith(chargerId, 1);
      expect(mockSessionService.updateSessionStatus).toHaveBeenCalledWith("internal-tx-100", "CHARGING");
      expect(mockOcppEvents.emitSessionStarted).toHaveBeenCalled();
      expect(mockMessageQueue.sendCallResult).toHaveBeenCalledWith(ws, messageId, expect.objectContaining({
        transactionId: 100,
        idTagInfo: expect.objectContaining({ status: mockStatus.ACCEPTED }),
      }));
    });

    it("should reject startTransaction when the user wallet balance is zero", async () => {
      const ws = {};
      const messageId = "msg-2";
      const chargerId = "charger-B";
      const payload = {
        connectorId: 1,
        idTag: "UNKNOWN-123",
        meterStart: 500,
        timestamp: new Date().toISOString(),
      };

      mockBookingService.validateBookingForStart.mockResolvedValue({ allowed: true, bookingId: null, type: "WALKIN" });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: "user-zero",
        wallet: {
          balance: 0,
        },
      });

      await startTransaction(ws, messageId, chargerId, payload);

      expect(mockSessionService.createSession).not.toHaveBeenCalled();
      expect(mockMessageQueue.sendCallResult).toHaveBeenCalledWith(ws, messageId, {
        transactionId: 0,
        idTagInfo: {
          status: "Blocked",
        },
      });
    });
  });

  describe("stopTransaction", () => {
    it("should finalize a charging session and perform final billing", async () => {
      const ws = {};
      const messageId = "msg-3";
      const chargerId = "charger-C";
      const payload = {
        idTag: "USER-ABC",
        meterStop: 5600,
        timestamp: new Date().toISOString(),
        transactionId: 100,
        reason: "EVDisconnected",
        transactionData: [
          {
            sampledValue: [
              { measurand: "Energy.Active.Import.Register", value: "5600", unit: "Wh" },
            ],
          },
        ],
      };

      mockPrisma.chargingSession.findUnique.mockResolvedValue({
        id: 100,
        transactionId: "TX-100",
        connector: { connectorId: 1 },
        userId: "user-1",
        startedAt: new Date(Date.now() - 15 * 60000),
        energyUsedWh: 4000,
        totalCost: "200.00",
      });
      mockBillingService.processMeterValuesBilling.mockResolvedValue({ success: true });
      mockSessionService.finalizeSession.mockResolvedValue({ alreadyFinalized: false, notFound: false });
      mockBillingService.finalizeSessionBilling.mockResolvedValue({ totalCost: "200.00" });
      mockSessionService.getSessionByTransactionId.mockResolvedValue({
        transactionId: "TX-100",
        userId: "user-1",
        energyUsedWh: 4400,
        totalCost: "220.00",
        startedAt: new Date(Date.now() - 15 * 60000),
      });
      mockConnectorLockService.markChargingComplete.mockResolvedValue({ success: true });

      await stopTransaction(ws, messageId, chargerId, payload);

      expect(mockBillingService.processMeterValuesBilling).toHaveBeenCalledTimes(2);
      expect(mockSessionService.finalizeSession).toHaveBeenCalledWith(expect.objectContaining({
        transactionId: "TX-100",
        meterStop: 5600,
      }));
      expect(mockBillingService.finalizeSessionBilling).toHaveBeenCalledWith("TX-100");
      expect(mockNotificationService.sendChargingComplete).toHaveBeenCalledWith(expect.objectContaining({
        userId: "user-1",
        transactionId: "TX-100",
      }));
      expect(mockConnectorLockService.markChargingComplete).toHaveBeenCalledWith(chargerId, 1, "TX-100");
      expect(mockChargerStore.updateChargerState).toHaveBeenCalledWith(chargerId, expect.objectContaining({
        transactionId: null,
        ocppTransactionId: null,
      }));
      expect(mockMessageQueue.sendCallResult).toHaveBeenCalledWith(ws, messageId, expect.any(Object));
    });

    it("should continue stop flow when final billing reports insufficient funds", async () => {
      const ws = {};
      const messageId = "msg-4";
      const chargerId = "charger-D";
      const payload = {
        idTag: "USER-DEF",
        meterStop: 4200,
        timestamp: new Date().toISOString(),
        transactionId: 200,
        reason: "EVDisconnected",
      };

      mockPrisma.chargingSession.findUnique.mockResolvedValue({
        id: 200,
        transactionId: "TX-200",
        connector: { connectorId: 2 },
        userId: "user-2",
      });
      mockBillingService.processMeterValuesBilling.mockResolvedValue({
        success: false,
        insufficientFunds: true,
      });
      mockSessionService.finalizeSession.mockResolvedValue({ alreadyFinalized: false, notFound: false });
      mockBillingService.finalizeSessionBilling.mockResolvedValue({ totalCost: "120.00" });
      mockSessionService.getSessionByTransactionId.mockResolvedValue({
        transactionId: "TX-200",
        userId: "user-2",
        energyUsedWh: 3000,
        totalCost: "120.00",
        startedAt: new Date(Date.now() - 10 * 60000),
      });
      mockConnectorLockService.markChargingComplete.mockResolvedValue({ success: true });

      await stopTransaction(ws, messageId, chargerId, payload);

      expect(mockBillingService.processMeterValuesBilling).toHaveBeenCalledWith(expect.objectContaining({
        transactionId: "TX-200",
        currentMeterWh: 4200,
        isFinal: true,
      }));
      expect(mockBillingService.finalizeSessionBilling).toHaveBeenCalledWith("TX-200");
      expect(mockNotificationService.sendChargingComplete).toHaveBeenCalled();
      expect(mockMessageQueue.sendCallResult).toHaveBeenCalledWith(ws, messageId, expect.any(Object));
    });
  });
});
