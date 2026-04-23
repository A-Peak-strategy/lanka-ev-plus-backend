import { chargersStore, getAllConnectorStates, getConnectorState, getConnectorCacheRaw } from "../services/chargerStore.service.js";
import { isChargerOnline, getConnectedChargerIds, getChargerMetadata } from "../ocpp/ocppServer.js";
import { startChargingForUser } from "../ocpp/commands/remoteStartTransaction.js";
import { stopChargingAtCharger, stopChargingAtConnector } from "../ocpp/commands/remoteStopTransaction.js";
import prisma from "../config/db.js";
import { NotFoundError, ChargerOfflineError, ConflictError, ValidationError } from "../errors/index.js";
import { validateChargerId, validateConnectorId } from "../utils/validation.js";

/**
 * Get all chargers (from memory and database)
 * 
 * GET /api/chargers
 */
export const getAllChargers = async (req, res, next) => {
  try {
    // Get chargers from database
    const dbChargers = await prisma.charger.findMany({
      include: {
        station: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
        connectors: {
          select: {
            connectorId: true,
            status: true,
          },
          orderBy: { connectorId: "asc" },
        },
      },
      orderBy: { lastSeen: "desc" },
    });

    // Merge with in-memory state
    const chargers = await Promise.all(dbChargers.map(async (charger) => {
      const online = isChargerOnline(charger.id);

      // Get per-connector live state
      const connMap = await getAllConnectorStates(charger.id);
      const connectorStates = [];

      if (connMap && connMap.size > 0) {
        for (const [connId, state] of connMap) {
          connectorStates.push({
            connectorId: connId,
            status: state?.status || "UNAVAILABLE",
            transactionId: state?.transactionId || null,
            ocppTransactionId: state?.ocppTransactionId || null,
            lastMeterValueWh: state?.lastMeterValueWh || null,
            userId: state?.userId || null,
          });
        }
      } else {
        // Use DB connector data as fallback
        for (const conn of charger.connectors) {
          connectorStates.push({
            connectorId: conn.connectorId,
            status: conn.status,
            transactionId: null,
            ocppTransactionId: null,
          });
        }
      }

      // Determine aggregate status from connectors
      let aggregateStatus = charger.status;
      if (connectorStates.length > 0) {
        const hasCharging = connectorStates.some(c => c.status === "CHARGING" || c.status === "Charging");
        const allAvailable = connectorStates.every(c => c.status === "AVAILABLE" || c.status === "Available");
        if (hasCharging) aggregateStatus = "CHARGING";
        else if (allAvailable) aggregateStatus = "AVAILABLE";
      }

      return {
        id: charger.id,
        serialNumber: charger.serialNumber,
        vendor: charger.vendor,
        model: charger.model,
        firmwareVersion: charger.firmwareVersion,
        status: aggregateStatus,
        connectionState: online ? "CONNECTED" : "DISCONNECTED",
        lastHeartbeat: charger.lastHeartbeat,
        lastSeen: charger.lastSeen,
        station: charger.station,
        connectors: connectorStates,
        connectorCount: Math.max(connectorStates.length, charger.connectors.length),
      };
    }));

    res.json({
      success: true,
      count: chargers.length,
      onlineCount: getConnectedChargerIds().length,
      chargers,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single charger details
 * 
 * GET /api/chargers/:chargerId
 */
export const getCharger = async (req, res, next) => {
  try {
    const { chargerId } = req.params;

    // Validate chargerId
    validateChargerId(chargerId);

    const charger = await prisma.charger.findUnique({
      where: { id: chargerId },
      include: {
        station: true,
        connectors: {
          orderBy: { connectorId: "asc" },
        },
        sessions: {
          take: 10,
          orderBy: { startedAt: "desc" },
        },
      },
    });

    if (!charger) {
      throw new NotFoundError("Charger", chargerId);
    }

    const online = isChargerOnline(chargerId);
    const metadata = getChargerMetadata(chargerId);

    // Get per-connector live state
    const connMap = await getAllConnectorStates(chargerId);
    const connectorStates = [];

    if (connMap && connMap.size > 0) {
      for (const [connId, state] of connMap) {
        connectorStates.push({
          connectorId: connId,
          status: state?.status || "UNAVAILABLE",
          transactionId: state?.transactionId || null,
          ocppTransactionId: state?.ocppTransactionId || null,
          meterStartWh: state?.meterStartWh || null,
          lastMeterValueWh: state?.lastMeterValueWh || null,
          userId: state?.userId || null,
          idTag: state?.idTag || null,
          sessionStartTime: state?.sessionStartTime || null,
        });
      }
    } else {
      for (const conn of charger.connectors) {
        connectorStates.push({
          connectorId: conn.connectorId,
          status: conn.status,
        });
      }
    }

    res.json({
      success: true,
      charger: {
        ...charger,
        connectionState: online ? "CONNECTED" : "DISCONNECTED",
        connectorStates,
        connectionMetadata: metadata,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Lookup charger by backup code, QR code data, or charger ID
 * 
 * GET /api/chargers/lookup?code=123456
 * 
 * Supports:
 *  - 6-digit backup code (e.g. "123456")
 *  - QR code URI (e.g. "evcharge://charger/CP001")
 *  - Charger ID directly (e.g. "CP001")
 */
export const lookupChargerByCode = async (req, res, next) => {
  try {
    const { code } = req.query;

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      throw new ValidationError("code query parameter is required");
    }

    const trimmedCode = code.trim();
    let charger = null;

    const chargerInclude = {
      station: true,
      connectors: {
        orderBy: { connectorId: "asc" },
      },
      sessions: {
        take: 10,
        orderBy: { startedAt: "desc" },
      },
    };

    // Check if it's a QR code URI format: evcharge://charger/{chargerId}
    const qrMatch = trimmedCode.match(/^evcharge:\/\/charger\/(.+)$/);

    if (qrMatch) {
      // QR code URI → extract charger ID
      charger = await prisma.charger.findUnique({
        where: { id: qrMatch[1] },
        include: chargerInclude,
      });
    } else {
      // Try backup code first
      charger = await prisma.charger.findUnique({
        where: { backupCode: trimmedCode },
        include: chargerInclude,
      });

      // If not found by backup code, try direct charger ID
      if (!charger) {
        charger = await prisma.charger.findUnique({
          where: { id: trimmedCode },
          include: chargerInclude,
        });
      }
    }

    if (!charger) {
      throw new NotFoundError("Charger", trimmedCode);
    }

    const online = isChargerOnline(charger.id);
    const metadata = getChargerMetadata(charger.id);

    // Get per-connector live state
    const connMap = await getAllConnectorStates(charger.id);
    const connectorStates = [];

    if (connMap && connMap.size > 0) {
      for (const [connId, state] of connMap) {
        connectorStates.push({
          connectorId: connId,
          status: state?.status || "UNAVAILABLE",
          transactionId: state?.transactionId || null,
          ocppTransactionId: state?.ocppTransactionId || null,
          userId: state?.userId || null,
        });
      }
    } else {
      for (const conn of charger.connectors) {
        connectorStates.push({
          connectorId: conn.connectorId,
          status: conn.status,
        });
      }
    }

    res.json({
      success: true,
      charger: {
        ...charger,
        connectionState: online ? "CONNECTED" : "DISCONNECTED",
        connectorStates,
        connectionMetadata: metadata,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get charger status (real-time) — now returns per-connector state
 * 
 * GET /api/chargers/:chargerId/status
 */
export const getChargerStatus = async (req, res, next) => {
  try {
    const { chargerId } = req.params;

    validateChargerId(chargerId);

    const online = isChargerOnline(chargerId);

    // Get all connector states
    const connMap = await getAllConnectorStates(chargerId);
    const connectors = [];

    if (connMap && connMap.size > 0) {
      for (const [connId, state] of connMap) {
        const meterStart = state?.meterStartWh;
        const lastMeter = state?.lastMeterValueWh;
        connectors.push({
          connectorId: connId,
          status: state?.status || "Unknown",
          transactionId: state?.transactionId ?? state?.ocppTransactionId ?? null,
          ocppTransactionId: state?.ocppTransactionId ?? null,
          meterWh: lastMeter ?? null,
          meterStart: meterStart ?? null,
          energyUsedWh: (meterStart != null && lastMeter != null)
            ? Math.max(0, lastMeter - meterStart)
            : null,
          lastMeterTime: state?.lastMeterTime ?? null,
          userId: state?.userId ?? null,
          sessionStartTime: state?.sessionStartTime ?? null,
        });
      }
    }

    if (connectors.length === 0 && !online) {
      throw new NotFoundError("Charger", chargerId);
    }

    res.json({
      success: true,
      chargerId,
      online,
      connectors,
      // Legacy flat fields for backward-compat (from connector 1)
      status: connectors[0]?.status || "Unknown",
      transactionId: connectors[0]?.transactionId || null,
      lastHeartbeat: connectors[0]?.lastHeartbeat || null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Start charging remotely — now connector-aware
 * 
 * POST /api/chargers/:chargerId/start
 * Body: { userId?: string, connectorId?: number, presetAmount?: number }
 */
export const startCharging = async (req, res, next) => {
  try {
    const { chargerId } = req.params;
    const { connectorId = 1, presetAmount } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      console.warn(`[START] No userId provided for starting charger ${chargerId}. Defaulting to USER_API_REQUEST. This may affect auditing and billing.`);
      throw new ValidationError("userId is required to start charging", "USER_ID_REQUIRED");
    }

    // Validate inputs
    validateChargerId(chargerId);
    const validConnectorId = validateConnectorId(connectorId);

    // Check if charger is online
    if (!isChargerOnline(chargerId)) {
      throw new ChargerOfflineError(chargerId);
    }

    // Check for existing active transaction on THIS connector (not the whole charger)
    const connState = await getConnectorState(chargerId, validConnectorId);
    if (connState?.transactionId || connState?.ocppTransactionId) {
      throw new ConflictError(
        `Connector ${validConnectorId} already has an active transaction`,
        "ACTIVE_TRANSACTION_EXISTS"
      );
    }

    // Validate and lock wallet funds if presetAmount is provided
    let lockedAmount = null;
    if (presetAmount && presetAmount > 0) {
      const walletService = await import("../services/wallet.service.js");

      try {
        const lockResult = await walletService.lockFunds(userId, presetAmount);
        lockedAmount = presetAmount;
        console.log(`[START] Locked LKR ${presetAmount} for user ${userId} on charger ${chargerId}#${validConnectorId}`);
      } catch (lockError) {
        if (lockError.name === "InsufficientBalanceError" || lockError.message?.includes("Insufficient")) {
          const available = await walletService.getAvailableBalance(userId);
          return res.status(400).json({
            success: false,
            error: "Insufficient balance",
            code: "INSUFFICIENT_BALANCE",
            message: `Your wallet balance (LKR ${available}) is insufficient for the requested amount (LKR ${presetAmount}). Please top up.`,
            availableBalance: available,
            requestedAmount: presetAmount.toString(),
          });
        }
        throw lockError;
      }
    }

    // Send RemoteStartTransaction
    const result = await startChargingForUser({
      chargerId,
      userId: userId || "USER_API_REQUEST",
      connectorId: validConnectorId,
      presetAmount: lockedAmount,
    });

    if (result.success) {
      res.json({
        success: true,
        message: `Remote start command accepted for connector ${validConnectorId}`,
        chargerId,
        connectorId: validConnectorId,
        presetAmount: lockedAmount,
      });
    } else {
      // If charger rejected, unlock the funds
      if (lockedAmount) {
        const walletService = await import("../services/wallet.service.js");
        await walletService.unlockFunds(userId, lockedAmount).catch(err =>
          console.error(`[START] Failed to unlock funds after rejection:`, err.message)
        );
      }
      throw new ConflictError(
        result.error || "Charger rejected start command",
        "CHARGER_REJECTED_START"
      );
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Stop charging remotely — now supports per-connector stop
 * 
 * POST /api/chargers/:chargerId/stop
 * Body: { connectorId?: number }
 */
export const stopCharging = async (req, res, next) => {
  try {
    const { chargerId } = req.params;
    const { connectorId } = req.body || {};

    validateChargerId(chargerId);

    // Check if charger is online
    if (!isChargerOnline(chargerId)) {
      throw new ChargerOfflineError(chargerId);
    }

    if (connectorId) {
      // Stop a specific connector
      const validConnectorId = validateConnectorId(connectorId);
      const connState = await getConnectorState(chargerId, validConnectorId);
      
      if (!connState?.transactionId && !connState?.ocppTransactionId) {
        throw new ConflictError(
          `No active transaction on connector ${validConnectorId}`,
          "NO_ACTIVE_TRANSACTION"
        );
      }

      const result = await stopChargingAtConnector(chargerId, validConnectorId);
      console.log("Stop Charging result:", JSON.stringify(result, null, 2));

      if (result.success) {
        res.json({
          success: true,
          message: `Remote stop command accepted for connector ${validConnectorId}`,
          chargerId,
          connectorId: validConnectorId,
          transactionId: result.transactionId,
        });
      } else {
        throw new ConflictError(
          result.error || "Charger rejected stop command",
          "CHARGER_REJECTED_STOP"
        );
      }
    } else {
      // Stop first active session found (backward-compat)
      // Check if ANY connector has an active session
      const connMap = await getAllConnectorStates(chargerId);
      let hasActive = false;
      if (connMap) {
        for (const [, state] of connMap) {
          if (state?.transactionId || state?.ocppTransactionId) {
            hasActive = true;
            break;
          }
        }
      }

      if (!hasActive) {
        throw new ConflictError(
          "No active transaction to stop",
          "NO_ACTIVE_TRANSACTION"
        );
      }

      const result = await stopChargingAtCharger(chargerId);
      console.log("Stop Charging result:", JSON.stringify(result, null, 2));

      if (result.success) {
        res.json({
          success: true,
          message: "Remote stop command accepted",
          chargerId,
          transactionId: result.transactionId,
        });
      } else {
        throw new ConflictError(
          result.error || "Charger rejected stop command",
          "CHARGER_REJECTED_STOP"
        );
      }
    }
  } catch (error) {
    console.error(`[STOP] Error stopping charger ${req.params.chargerId}:`, error.message, error.stack);
    next(error);
  }
};

/**
 * Get charger sessions
 * 
 * GET /api/chargers/:chargerId/sessions
 */
export const getChargerSessions = async (req, res, next) => {
  try {
    const { chargerId } = req.params;
    const { limit = 20, offset = 0, active } = req.query;

    validateChargerId(chargerId);

    const where = { chargerId };
    if (active === "true") {
      where.endedAt = null;
    } else if (active === "false") {
      where.endedAt = { not: null };
    }

    const sessions = await prisma.chargingSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: parseInt(limit) || 20,
      skip: parseInt(offset) || 0,
      include: {
        user: {
          select: { id: true, name: true },
        },
        connector: {
          select: { connectorId: true },
        },
      },
    });

    res.json({
      success: true,
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    next(error);
  }
};

//? Get live session data for mobile app (used for real-time updates during charging)
export async function getLiveSession(req, res) {
  const { transactionId } = req.params;
  const sessionId = Number(transactionId);

  if (isNaN(sessionId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid transactionId format"
    });
  }

  // Fetch live meter data and session billing info in parallel
  const [live, session] = await Promise.all([
    prisma.chargingSessionLive.findUnique({
      where: { sessionId },
    }),
    prisma.chargingSession.findUnique({
      where: { id: sessionId },
      select: {
        totalCost: true,
        pricePerKwh: true,
        connector: {
          select: { connectorId: true },
        },
      },
    }),
  ]);

  if (!live) {
    return res.status(404).json({
      success: false,
      message: "Live session not found"
    });
  }

  res.json({
    success: true,
    data: {
      energyWh: live.energyWh,
      powerW: live.powerW,
      voltageV: live.voltageV,
      currentA: live.currentA,
      socPercent: live.socPercent,
      temperatureC: live.temperatureC,
      lastUpdated: live.lastMeterAt,
      totalCost: session?.totalCost?.toString() ?? "0.00",
      pricePerKwh: session?.pricePerKwh?.toString() ?? null,
      connectorId: session?.connector?.connectorId ?? null,
    }
  });
}
