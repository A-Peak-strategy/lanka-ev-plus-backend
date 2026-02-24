import prisma from "../config/db.js";
import Decimal from "decimal.js";
import walletService from "./wallet.service.js";
import { generateIdempotencyKey } from "./ledger.service.js";
import notificationService from "./notification.service.js";
import { SessionNotFoundError, SessionAlreadyActiveError } from "../errors/index.js";

/**
 * Session Service
 * 
 * Manages charging session lifecycle:
 * - Session creation
 * - Session updates
 * - Session finalization
 * - Fault handling with partial refund
 * - Offline replay support
 */

/**
 * Create a new charging session
 * 
 * @param {object} data
 * @returns {Promise<object>} Created session
 */
export async function createSession(data) {
  const {
    chargerId,
    connectorId,
    transactionId,
    idTag,
    userId,
    meterStart,
    timestamp,
    pricePerKwh,
  } = data;

  // Idempotency check - prevent duplicate session creation
  const existing = await prisma.chargingSession.findUnique({
    where: { transactionId },
  });

  if (existing) {
    console.log(`Session ${transactionId} already exists, returning existing`);
    return { session: existing, duplicate: true };
  }

  // Get connector record if exists
  let connector = null;
  if (connectorId) {
    connector = await prisma.connector.findUnique({
      where: {
        chargerId_connectorId: {
          chargerId,
          connectorId: parseInt(connectorId),
        },
      },
    });

    // CRITICAL: Check for existing active session on this connector
    if (connector) {
      const activeSessionOnConnector = await prisma.chargingSession.findFirst({
        where: {
          connectorId: connector.id,
          endedAt: null,
        },
      });

      if (activeSessionOnConnector) {
        console.warn(
          `[SESSION] Active session ${activeSessionOnConnector.transactionId} exists on connector ${connectorId}`
        );
        // Return existing session instead of throwing - charger may have restarted
        return {
          session: activeSessionOnConnector,
          duplicate: true,
          reason: "Connector has active session"
        };
      }
    }
  }

  // Also check for active session on charger (any connector)
  const activeSessionOnCharger = await prisma.chargingSession.findFirst({
    where: {
      chargerId,
      endedAt: null,
    },
  });

  if (activeSessionOnCharger) {
    console.warn(
      `[SESSION] Active session ${activeSessionOnCharger.transactionId} exists on charger ${chargerId}`
    );
    // For single-connector chargers, this might be the same session
    // Only warn, don't block - let the new transaction take over
  }

  const session = await prisma.chargingSession.create({
    data: {
      chargerId,
      connectorId: connector?.id,
      transactionId,
      idTag,
      userId,
      meterStartWh: meterStart || 0,
      startedAt: timestamp ? new Date(timestamp) : new Date(),
      pricePerKwh: pricePerKwh ? new Decimal(pricePerKwh).toFixed(2) : null,
      lastBilledWh: meterStart || 0,
    },
  });

  console.log(`✅ >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>Session created: ${transactionId}`);

  return { session, duplicate: false };
}

/**
 * Update session meter values
 * 
 * @param {number} sessionId - ChargingSession.id (primary key)
 * @param {number} meterWh
 * @returns {Promise<object>} Updated session
 */
export async function updateSessionMeter(sessionId, meterWh) {
  const session = await prisma.chargingSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }

  const energyUsed = meterWh - (session.meterStartWh || 0);

  const updated = await prisma.chargingSession.update({
    where: { id: sessionId },
    data: {
      energyUsedWh: Math.max(0, energyUsed),
    },
  });

  return updated;
}

/**
 * Finalize (stop) a charging session
 * 
 * @param {object} data
 * @returns {Promise<object>} Finalized session
 */
export async function finalizeSession(data) {
  const {
    transactionId,
    meterStop,
    timestamp,
    reason,
    idTag,
  } = data;

  const session = await prisma.chargingSession.findUnique({
    where: { transactionId },
  });

  if (!session) {
    // Log but don't throw - may be offline replay for unknown transaction
    console.warn(`[SESSION] Session not found for finalization: ${transactionId}`);
    return { session: null, alreadyFinalized: false, notFound: true };
  }

  if (session.endedAt) {
    console.log(`Session ${transactionId} already finalized`);
    return { session, alreadyFinalized: true };
  }

  const endTime = timestamp ? new Date(timestamp) : new Date();
  const energyUsed = (meterStop || 0) - (session.meterStartWh || 0);

  const updated = await prisma.chargingSession.update({
    where: { transactionId },
    data: {
      meterStopWh: meterStop,
      endedAt: endTime,
      energyUsedWh: Math.max(0, energyUsed),
      stopReason: mapStopReason(reason),
    },
  });

  console.log(`✅ Session finalized: ${transactionId}, energy: ${energyUsed}Wh`);

  return { session: updated, alreadyFinalized: false };
}

/**
 * Handle session fault with partial refund
 * 
 * When a charger faults during a session:
 * 1. Stop the session
 * 2. Calculate energy actually delivered
 * 3. Refund any overcharged amount
 * 
 * @param {object} data
 */
export async function handleSessionFault(data) {
  const { chargerId, connectorId, transactionId, errorCode } = data;

  console.log(`⚠️ Handling session fault: ${transactionId}, error: ${errorCode}`);

  // Get session
  const session = await prisma.chargingSession.findUnique({
    where: { transactionId },
    include: { user: true },
  });

  if (!session) {
    console.warn(`No session found for fault: ${transactionId}`);
    return;
  }

  if (session.endedAt) {
    console.log(`Session already ended, skipping fault handling`);
    return;
  }

  // Calculate actual energy delivered
  const lastMeterWh = session.energyUsedWh || 0;
  const actualCost = calculateActualCost(lastMeterWh, session.pricePerKwh);
  const chargedAmount = new Decimal(session.totalCost?.toString() || "0");
  const refundAmount = chargedAmount.minus(actualCost);

  // Process refund if we overcharged
  if (refundAmount.gt(0) && session.userId) {
    const idempotencyKey = generateIdempotencyKey(
      "refund",
      transactionId,
      "fault"
    );

    await walletService.processRefund({
      userId: session.userId,
      amount: refundAmount.toFixed(2),
      reason: `Partial refund due to charger fault: ${errorCode}`,
      referenceId: transactionId,
      idempotencyKey,
    });

    console.log(`💰 Refunded ${refundAmount.toFixed(2)} for faulted session`);
  }

  // Finalize session
  await prisma.chargingSession.update({
    where: { transactionId },
    data: {
      endedAt: new Date(),
      stopReason: "CHARGER_FAULT",
      totalCost: actualCost.toFixed(2),
    },
  });

  // Notify user
  if (session.userId) {
    await notificationService.sendChargingForceStopped({
      userId: session.userId,
      transactionId,
      reason: `Charger fault: ${errorCode}`,
      energyUsedWh: lastMeterWh,
      totalCost: actualCost.toFixed(2),
    });
  }
}

/**
 * Get active session for a charger
 * 
 * @param {string} chargerId
 * @returns {Promise<object|null>}
 */
export async function getActiveSession(chargerId) {
  return prisma.chargingSession.findFirst({
    where: {
      chargerId,
      endedAt: null,
    },
    orderBy: { startedAt: "desc" },
  });
}

/**
 * Get active session by transaction ID
 * 
 * @param {string} transactionId
 * @returns {Promise<object|null>}
 */
export async function getSessionByTransactionId(transactionId) {
  return prisma.chargingSession.findUnique({
    where: { transactionId },
    include: {
      user: true,
      charger: true,
    },
  });
}

/**
 * Recover session after charger reconnection
 * 
 * When a charger reconnects, check for any open sessions
 * and resume billing if needed.
 * 
 * @param {string} chargerId
 * @returns {Promise<object|null>} Recovered session
 */
export async function recoverSessionAfterReconnect(chargerId) {
  const session = await getActiveSession(chargerId);

  if (!session) {
    return null;
  }

  console.log(`🔄 Recovering session ${session.transactionId} for ${chargerId}`);

  // Session exists but charger reconnected - the charger will send
  // StatusNotification and MeterValues which will continue the session

  return session;
}

/**
 * Handle offline replay of transactions
 * 
 * When a charger was offline and sends historical transactions,
 * process them with idempotency to prevent duplicates.
 * 
 * @param {object} data - StartTransaction or StopTransaction data
 * @param {string} type - "start" or "stop"
 */
export async function handleOfflineReplay(data, type) {
  if (type === "start") {
    const result = await createSession(data);
    if (result.duplicate) {
      console.log(`📥 Offline replay: Session ${data.transactionId} already exists`);
    }
    return result;
  }

  if (type === "stop") {
    const result = await finalizeSession(data);
    if (result.alreadyFinalized) {
      console.log(`📥 Offline replay: Session ${data.transactionId} already stopped`);
    }
    return result;
  }
}

/**
 * Get session statistics for a user
 * 
 * @param {string} userId
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function getUserSessionStats(userId, options = {}) {
  const { startDate, endDate } = options;

  const where = { userId };
  if (startDate || endDate) {
    where.startedAt = {};
    if (startDate) where.startedAt.gte = new Date(startDate);
    if (endDate) where.startedAt.lte = new Date(endDate);
  }

  const sessions = await prisma.chargingSession.findMany({
    where,
    select: {
      energyUsedWh: true,
      totalCost: true,
      startedAt: true,
      endedAt: true,
    },
  });

  const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyUsedWh || 0), 0);
  const totalCost = sessions.reduce(
    (sum, s) => sum.plus(new Decimal(s.totalCost?.toString() || "0")),
    new Decimal(0)
  );
  const totalSessions = sessions.length;
  const completedSessions = sessions.filter((s) => s.endedAt).length;

  return {
    totalEnergy,
    totalEnergyKwh: (totalEnergy / 1000).toFixed(2),
    totalCost: totalCost.toFixed(2),
    totalSessions,
    completedSessions,
  };
}

// Helper functions
function calculateActualCost(energyWh, pricePerKwh) {
  if (!pricePerKwh) {
    return new Decimal(0);
  }
  const energyKwh = new Decimal(energyWh).dividedBy(1000);
  return energyKwh.times(new Decimal(pricePerKwh.toString()));
}

function mapStopReason(ocppReason) {
  const mapping = {
    EmergencyStop: "EMERGENCY_STOP",
    EVDisconnected: "USER_REQUESTED",
    HardReset: "OTHER",
    Local: "USER_REQUESTED",
    Other: "OTHER",
    PowerLoss: "OTHER",
    Reboot: "OTHER",
    Remote: "REMOTE_STOP",
    SoftReset: "OTHER",
    UnlockCommand: "REMOTE_STOP",
    DeAuthorized: "OTHER",
  };

  return mapping[ocppReason] || "OTHER";
}

export default {
  createSession,
  updateSessionMeter,
  finalizeSession,
  handleSessionFault,
  getActiveSession,
  getSessionByTransactionId,
  recoverSessionAfterReconnect,
  handleOfflineReplay,
  getUserSessionStats,
};

