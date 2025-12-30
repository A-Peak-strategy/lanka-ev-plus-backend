import { chargersStore } from "../services/chargerStore.service.js";
import { isChargerOnline, getConnectedChargerIds, getChargerMetadata } from "../ocpp/ocppServer.js";
import { startChargingForUser } from "../ocpp/commands/remoteStartTransaction.js";
import { stopChargingAtCharger } from "../ocpp/commands/remoteStopTransaction.js";
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
        },
      },
      orderBy: { lastSeen: "desc" },
    });

    // Merge with in-memory state
    const chargers = dbChargers.map((charger) => {
      const memState = chargersStore.get(charger.id);
      const online = isChargerOnline(charger.id);

      return {
        id: charger.id,
        serialNumber: charger.serialNumber,
        vendor: charger.vendor,
        model: charger.model,
        firmwareVersion: charger.firmwareVersion,
        status: memState?.status || charger.status,
        connectionState: online ? "CONNECTED" : "DISCONNECTED",
        lastHeartbeat: memState?.lastHeartbeat || charger.lastHeartbeat,
        lastSeen: charger.lastSeen,
        station: charger.station,
        connectors: charger.connectors,
        // Active transaction info
        activeTransaction: memState?.transactionId || null,
        currentMeterWh: memState?.lastMeterValue || null,
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

    const memState = chargersStore.get(chargerId);
    const online = isChargerOnline(chargerId);
    const metadata = getChargerMetadata(chargerId);

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
export const getChargerStatus = (req, res, next) => {
  try {
    const { chargerId } = req.params;
    
    validateChargerId(chargerId);
    
    const memState = chargersStore.get(chargerId);
    const online = isChargerOnline(chargerId);

    if (!memState && !online) {
      throw new NotFoundError("Charger", chargerId);
    }

    res.json({
      success: true,
      chargerId,
      online,
      status: memState?.status || "Unknown",
      connectorId: memState?.connectorId,
      transactionId: memState?.transactionId,
      meterWh: memState?.lastMeterValue,
      meterStart: memState?.meterStart,
      energyUsedWh: memState?.meterStart 
        ? (memState.lastMeterValue || 0) - memState.meterStart 
        : null,
      lastHeartbeat: memState?.lastHeartbeat,
      lastMeterTime: memState?.lastMeterTime,
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
  try {
    const { chargerId } = req.params;
    const { userId, connectorId = 1 } = req.body;

    // Validate inputs
    validateChargerId(chargerId);
    const validConnectorId = validateConnectorId(connectorId);

    // Check if charger is online
    if (!isChargerOnline(chargerId)) {
      throw new ChargerOfflineError(chargerId);
    }

    // Check for existing active transaction
    const memState = chargersStore.get(chargerId);
    if (memState?.transactionId) {
      throw new ConflictError(
        "Charger already has an active transaction",
        "ACTIVE_TRANSACTION_EXISTS"
      );
    }

    // Send RemoteStartTransaction
    const result = await startChargingForUser({
      chargerId,
      userId: userId || "USER_API_REQUEST",
      connectorId: validConnectorId,
    });

    if (result.success) {
      res.json({
        success: true,
        message: "Remote start command accepted",
        chargerId,
        connectorId: validConnectorId,
      });
    } else {
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

    // Check for active transaction
    const memState = chargersStore.get(chargerId);
    if (!memState?.transactionId) {
      throw new ConflictError(
        "No active transaction to stop",
        "NO_ACTIVE_TRANSACTION"
      );
    }

    // Send RemoteStopTransaction
    const result = await stopChargingAtCharger(chargerId);

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
