import { chargersStore, getChargerKey } from "../services/chargerStore.service.js";
import Decimal from "decimal.js";
import { isChargerOnline, getConnectedChargerIds, getChargerMetadata } from "../ocpp/ocppServer.js";
import { startChargingForUser } from "../ocpp/commands/remoteStartTransaction.js";
import { stopChargingAtCharger, remoteStopTransaction } from "../ocpp/commands/remoteStopTransaction.js";
import prisma from "../config/db.js";
import { NotFoundError, ChargerOfflineError, ConflictError, ValidationError } from "../errors/index.js";
import { validateChargerId, validateConnectorId } from "../utils/validation.js";
import sessionService from "../services/session.service.js";
import * as walletService from "../services/wallet.service.js";

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
            pricing: true,
          },
        },
        connectors: {
          select: {
            connectorId: true,
            status: true,
          },
        },
      },
      orderBy: { lastSeen: "desc" },
    });

    // Merge with in-memory state
    const chargers = dbChargers.map((charger) => {
      const online = isChargerOnline(charger.id);

      // Update connector statuses from memory
      const connectors = charger.connectors.map(conn => {
        const memState = chargersStore.get(getChargerKey(charger.id, conn.connectorId));
        return {
          ...conn,
          status: memState?.status || conn.status,
          activeTransaction: memState?.transactionId || null,
        };
      });

      // Charger-wide status: AVAILABLE if any connector is available
      const hasAvailable = connectors.some(c => c.status === "AVAILABLE");
      const allFaulted = connectors.length > 0 && connectors.every(c => c.status === "FAULTED");

      let chargerStatus = charger.status;
      if (connectors.length > 0) {
        if (hasAvailable) chargerStatus = "AVAILABLE";
        else if (allFaulted) chargerStatus = "FAULTED";
        else chargerStatus = connectors[0].status; // Fallback to first connector
      }

      return {
        id: charger.id,
        serialNumber: charger.serialNumber,
        vendor: charger.vendor,
        model: charger.model,
        firmwareVersion: charger.firmwareVersion,
        status: chargerStatus,
        connectionState: online ? "CONNECTED" : "DISCONNECTED",
        lastHeartbeat: charger.lastHeartbeat, // Ideally we'd get this from memory too
        lastSeen: charger.lastSeen,
        station: charger.station,
        connectors: connectors,
      };
    });

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
        connectors: true,
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
    // Update connector statuses from memory
    const connectors = charger.connectors.map(conn => {
      const memState = chargersStore.get(getChargerKey(charger.id, conn.connectorId));
      return {
        ...conn,
        status: memState?.status || conn.status,
        activeTransaction: memState?.transactionId || null,
        currentMeterWh: memState?.lastMeterValueWh || null,
      };
    });

    // Charger-wide status: AVAILABLE if any connector is AVAILABLE
    const hasAvailable = connectors.some(c => c.status === "AVAILABLE");
    const allFaulted = connectors.length > 0 && connectors.every(c => c.status === "FAULTED");

    let chargerStatus = charger.status;
    if (connectors.length > 0) {
      if (hasAvailable) chargerStatus = "AVAILABLE";
      else if (allFaulted) chargerStatus = "FAULTED";
      else chargerStatus = connectors[0].status;
    }

    res.json({
      success: true,
      charger: {
        ...charger,
        status: chargerStatus,
        connectionState: online ? "CONNECTED" : "DISCONNECTED",
        connectors: connectors,
      },
      online,
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
      connectors: true,
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

    const memState = chargersStore.get(charger.id);
    const online = isChargerOnline(charger.id);
    const metadata = getChargerMetadata(charger.id);

    res.json({
      success: true,
      charger: {
        ...charger,
        status: memState?.status || charger.status,
        connectionState: online ? "CONNECTED" : "DISCONNECTED",
        activeTransaction: memState?.transactionId || null,
        currentMeterWh: memState?.lastMeterValue || null,
        connectionMetadata: metadata,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get charger status (real-time)
 * 
 * GET /api/chargers/:chargerId/status
 */
export const getChargerStatus = async (req, res, next) => {
  try {
    const { chargerId } = req.params;

    validateChargerId(chargerId);

    const userId = req.user?.id;
    const queryConnectorId = req.query.connectorId ? parseInt(req.query.connectorId) : null;
    let connectorId = queryConnectorId || 1;
    let memState = null;

    if (userId || queryConnectorId) {
      // If connectorId was explicitly requested, use it
      if (queryConnectorId) {
        memState = chargersStore.get(getChargerKey(chargerId, queryConnectorId));
      }

      // If still no state and we have a user, try to find their active session
      if (!memState && userId) {
        const activeSessions = await sessionService.getActiveSessionsForUser(userId);
        const session = activeSessions.find(s => s.chargerId === chargerId);

        if (session && session.connector) {
          connectorId = session.connector.connectorId;
          memState = chargersStore.get(getChargerKey(chargerId, connectorId));
        }
      }
    }

    // Get charger summary status from DB if no specific session state is found
    const charger = await prisma.charger.findUnique({
      where: { id: chargerId },
      select: { status: true }
    });

    const online = isChargerOnline(chargerId);

    if (!memState && !online && !charger) {
      throw new NotFoundError("Charger", chargerId);
    }

    // If no specific session state, use connector 1's state for metadata if available,
    // but override the status with the charger's summary status
    const defaultState = chargersStore.get(getChargerKey(chargerId, 1));
    const responseState = memState || defaultState;

    res.json({
      success: true,
      chargerId,
      online,
      // Use the specific connector status if the user is charging, 
      // otherwise use the charger's summary status (e.g. "Available")
      status: memState ? (memState.status || "Unknown") : (charger?.status || "Unknown"),
      connectorId: memState?.connectorId || connectorId,
      transactionId: memState?.ocppTransactionId || (typeof memState?.transactionId === 'number' ? memState.transactionId : null),
      ocppTransactionId: memState?.ocppTransactionId,
      internalTransactionId: memState?.internalTransactionId,
      meterWh: memState?.lastMeterValueWh,
      meterStart: memState?.meterStartWh,
      energyUsedWh: memState?.lastMeterValueWh && memState?.meterStartWh
        ? memState.lastMeterValueWh - memState.meterStartWh
        : 0,
      sessionStartTime: memState?.sessionStartTime,
      lastHeartbeat: responseState?.lastHeartbeat,
      lastMeterTime: memState?.lastStatusUpdate,
      userId: memState?.userId,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Start charging remotely
 * 
 * POST /api/chargers/:chargerId/start
 * Body: { userId?: string, connectorId?: number }
 */
export const startCharging = async (req, res, next) => {
  let lockedAmount = null;
  let userId = null;

  try {
    const { chargerId } = req.params;
    const { connectorId = 1, presetAmount } = req.body;

    userId = req.user?.id;

    if (!userId) {
      throw new ValidationError(
        "userId is required to start charging",
        "USER_ID_REQUIRED"
      );
    }

    // Validate inputs
    validateChargerId(chargerId);
    const validConnectorId = validateConnectorId(connectorId);

    // Charger must be online
    if (!isChargerOnline(chargerId)) {
      throw new ChargerOfflineError(chargerId);
    }

    // Ensure connector is not already in use
    const memState = chargersStore.get(
      getChargerKey(chargerId, validConnectorId)
    );

    if (memState?.transactionId) {
      throw new ConflictError(
        `Connector ${validConnectorId} already has an active transaction`,
        "ACTIVE_TRANSACTION_EXISTS"
      );
    }

    // Lock wallet funds (preset amount is required and must keep a 100 LKR buffer)
    if (presetAmount === undefined || presetAmount === null) {
      throw new ValidationError(
        "Preset amount is required to start charging",
        "PRESET_AMOUNT_REQUIRED"
      );
    }

    const presetAmountNum = Number(presetAmount);
    if (isNaN(presetAmountNum) || presetAmountNum <= 0) {
      throw new ValidationError(
        "Preset amount must be a positive number",
        "INVALID_PRESET_AMOUNT"
      );
    }

    const availableBalance = await walletService.getAvailableBalance(userId);
    const availableBalanceDecimal = new Decimal(availableBalance);
    const maxAllowedPreset = availableBalanceDecimal.minus(100);

    if (maxAllowedPreset.lte(0)) {
      return res.status(400).json({
        success: false,
        error: "Insufficient balance",
        code: "INSUFFICIENT_BALANCE",
        message: `Your wallet balance (LKR ${availableBalanceDecimal.toFixed(2)}) is insufficient. A minimum buffer of LKR 100.00 must remain in your wallet to start charging. Please top up.`,
        availableBalance: availableBalanceDecimal.toFixed(2),
        requestedAmount: presetAmountNum,
      });
    }

    if (new Decimal(presetAmountNum).gt(maxAllowedPreset)) {
      return res.status(400).json({
        success: false,
        error: "Insufficient balance",
        code: "INSUFFICIENT_BALANCE",
        message: `Your wallet balance (LKR ${availableBalanceDecimal.toFixed(2)}) is insufficient to support a budget of LKR ${presetAmountNum.toFixed(2)}. A minimum buffer of LKR 100.00 must remain. Based on your current balance, you can allocate up to LKR ${maxAllowedPreset.toFixed(2)} for charging.`,
        availableBalance: availableBalanceDecimal.toFixed(2),
        requestedAmount: presetAmountNum,
      });
    }

    try {
      await walletService.lockFunds(userId, presetAmountNum);
      lockedAmount = presetAmountNum;
      console.log(
        `[START] Locked LKR ${lockedAmount} for user ${userId} on charger ${chargerId}`
      );
    } catch (lockError) {
      const insufficientBalance =
        lockError.name === "InsufficientBalanceError" ||
        lockError.message?.includes("Insufficient");

      if (insufficientBalance) {
        return res.status(400).json({
          success: false,
          error: "Insufficient balance",
          code: "INSUFFICIENT_BALANCE",
          message: `Your wallet balance (LKR ${availableBalance}) is insufficient for the requested amount (LKR ${presetAmountNum}). Please top up.`,
          availableBalance,
          requestedAmount: presetAmountNum,
        });
      }
      throw lockError;
    }

    // Send RemoteStartTransaction
    const result = await startChargingForUser({
      chargerId,
      userId,
      connectorId: validConnectorId,
      presetAmount: lockedAmount,
    });

    // Charger rejected request
    if (!result.success) {
      if (lockedAmount) {
        try {
          await walletService.unlockFunds(userId, lockedAmount);

          console.log(
            `[START] Unlocked LKR ${lockedAmount} after charger rejected start`
          );

          // Prevent double unlock in catch block
          lockedAmount = null;
        } catch (unlockError) {
          console.error(
            `[START] Failed to unlock funds after rejection:`,
            unlockError
          );
        }
      }

      throw new ConflictError(
        result.error || "Charger rejected start command",
        "CHARGER_REJECTED_START"
      );
    }

    // IMPORTANT:
    // At this point funds remain locked.
    // StopTransaction flow is responsible for settlement/unlock.

    return res.json({
      success: true,
      message: "Remote start command accepted",
      chargerId,
      connectorId: validConnectorId,
      presetAmount: lockedAmount,
    });
  } catch (error) {
    // Only unlock if we still own the lock.
    // If start was successful, lockedAmount should remain locked.
    if (lockedAmount) {
      try {
        await walletService.unlockFunds(userId, lockedAmount);

        console.log(
          `[START] Unlocked LKR ${lockedAmount} due to start failure`
        );

        lockedAmount = null;
      } catch (unlockError) {
        console.error(
          `[START] Failed to unlock funds after unexpected error:`,
          unlockError
        );
      }
    }

    return next(error);
  }
};
// export const startCharging = async (req, res, next) => {
//   let lockedAmount = null;
//   let userId = null;
//   try {
//     const { chargerId } = req.params;
//     const { connectorId = 1, presetAmount } = req.body;
//     userId = req.user?.id;

//     if (!userId) {
//       console.warn(`[START] No userId provided for starting charger ${chargerId}. Defaulting to USER_API_REQUEST. This may affect auditing and billing.`);
//       throw new ValidationError("userId is required to start charging", "USER_ID_REQUIRED");
//     }

//     // Validate inputs
//     validateChargerId(chargerId);
//     const validConnectorId = validateConnectorId(connectorId);

//     // Check if charger is online
//     if (!isChargerOnline(chargerId)) {
//       throw new ChargerOfflineError(chargerId);
//     }

//     // Check for existing active transaction on this specific connector
//     const memState = chargersStore.get(getChargerKey(chargerId, validConnectorId));
//     if (memState?.transactionId) {
//       throw new ConflictError(
//         `Connector ${validConnectorId} already has an active transaction`,
//         "ACTIVE_TRANSACTION_EXISTS"
//       );
//     }

//     // Validate and lock wallet funds if presetAmount is provided
//     if (presetAmount && presetAmount > 0) {
//       try {
//         const lockResult = await walletService.lockFunds(userId, presetAmount);
//         lockedAmount = presetAmount;
//         console.log(`[START] Locked LKR ${presetAmount} for user ${userId} on charger ${chargerId}`);
//       } catch (lockError) {
//         if (lockError.name === "InsufficientBalanceError" || lockError.message?.includes("Insufficient")) {
//           const available = await walletService.getAvailableBalance(userId);
//           return res.status(400).json({
//             success: false,
//             error: "Insufficient balance",
//             code: "INSUFFICIENT_BALANCE",
//             message: `Your wallet balance (LKR ${available}) is insufficient for the requested amount (LKR ${presetAmount}). Please top up.`,
//             availableBalance: available,
//             requestedAmount: presetAmount.toString(),
//           });
//         }
//         throw lockError;
//       }
//     }

//     // Send RemoteStartTransaction
//     const result = await startChargingForUser({
//       chargerId,
//       userId: userId || "USER_API_REQUEST",
//       connectorId: validConnectorId,
//       presetAmount: lockedAmount,
//     });

//     if (result.success) {
//       res.json({
//         success: true,
//         message: "Remote start command accepted",
//         chargerId,
//         connectorId: validConnectorId,
//         presetAmount: lockedAmount,
//       });
//     } else {
//       // If charger rejected, unlock the funds
//       if (lockedAmount) {
//         await walletService.unlockFunds(userId, lockedAmount).catch(err =>
//           console.error(`[START] Failed to unlock funds after rejection:`, err.message)
//         );
//       }
//       throw new ConflictError(
//         result.error || "Charger rejected start command",
//         "CHARGER_REJECTED_START"
//       );
//     }
//   } catch (error) {
//     if (lockedAmount) {
//       await walletService.unlockFunds(userId, lockedAmount).catch(err =>
//         console.error(`[START] Failed to unlock funds after unexpected error:`, err.message)
//       );
//     }
//     next(error);
//   }
// };

/**
 * Stop charging remotely
 * 
 * POST /api/chargers/:chargerId/stop
 */
export const stopCharging = async (req, res, next) => {
  try {
    const { chargerId } = req.params;

    validateChargerId(chargerId);

    // Check if charger is online
    if (!isChargerOnline(chargerId)) {
      throw new ChargerOfflineError(chargerId);
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new ValidationError("userId is required to stop charging");
    }

    const { connectorId } = req.body;

    // Find active session for this user
    const activeSessions = await sessionService.getActiveSessionsForUser(userId);
    let session;

    if (connectorId) {
      session = activeSessions.find(s => s.chargerId === chargerId && s.connector?.connectorId === parseInt(connectorId));
    } else {
      session = activeSessions.find(s => s.chargerId === chargerId);
    }

    if (!session) {
      throw new ConflictError(
        "No active transaction found for this user on this charger",
        "NO_ACTIVE_TRANSACTION"
      );
    }

    // Send RemoteStopTransaction using the session's primary key (id)
    // session.id is what we sent to the charger as transactionId during StartTransaction
    const result = await remoteStopTransaction(chargerId, session.id);
    console.log("Stop Charging result : ", JSON.stringify(result, null, 2));

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
    }
  });
}


/**
 * Get charger pricing
 * 
 * GET /api/chargers/:chargerId/pricing
 */
export const getChargerPricing = async (req, res, next) => {
  try {
    const { chargerId } = req.params;

    validateChargerId(chargerId);

    const charger = await prisma.charger.findUnique({
      where: { id: chargerId },
      include: {
        station: {
          include: {
            pricing: true,
          },
        },
      },
    });

    if (!charger) {
      throw new NotFoundError("Charger", chargerId);
    }

    const pricing = charger.station?.pricing;

    res.json({
      success: true,
      pricing: pricing || null,
    });
  } catch (error) {
    next(error);
  }
};

