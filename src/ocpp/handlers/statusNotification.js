import { sendCallResult } from "../messageQueue.js";
import { ChargePointStatus, ChargePointErrorCode } from "../ocppConstants.js";
import { updateConnectorState, getConnectorState } from "../../services/chargerStore.service.js";
import { ocppEvents } from "../ocppEvents.js";
import prisma from "../../config/db.js";
import sessionService from "../../services/session.service.js";

/**
 * OCPP StatusNotification Handler
 * 
 * Sent by the Charge Point when connector status changes.
 * 
 * Request: {
 *   connectorId: number (0 = charger overall, 1+ = specific connector),
 *   errorCode: ChargePointErrorCode,
 *   info?: string,
 *   status: ChargePointStatus,
 *   timestamp?: ISO8601,
 *   vendorId?: string,
 *   vendorErrorCode?: string
 * }
 * 
 * Response: {} (empty)
 */
export default async function statusNotification(ws, messageId, chargerId, payload) {
  const {
    connectorId,
    errorCode,
    info,
    status,
    timestamp,
    vendorId,
    vendorErrorCode,
  } = payload;

  const statusTime = timestamp ? new Date(timestamp) : new Date();

  console.log(`[STATUS] ${chargerId}#${connectorId}: ${status} (${errorCode})`);

  // connectorId 0 = overall charger status (not a specific connector)
  if (connectorId === 0) {
    // Update charger-level status in DB only
    await updateChargerOverallStatus(chargerId, status, errorCode);
    sendCallResult(ws, messageId, {});
    return;
  }

  // Update in-memory state for this specific connector
  await updateConnectorState(chargerId, connectorId, {
    status,
    errorCode,
    connectionStatus: "Connected",
    lastStatusUpdate: statusTime,
  });

  // Handle specific status changes
  await handleStatusChange(chargerId, connectorId, status, errorCode, info);

  // Emit event
  ocppEvents.emitStatusChanged(chargerId, connectorId, status, errorCode, info);

  // Update database
  await updateConnectorStatus(chargerId, connectorId, status, errorCode);

  // Send empty response
  sendCallResult(ws, messageId, {});
}

/**
 * Handle specific status changes
 */
async function handleStatusChange(chargerId, connectorId, status, errorCode, info) {
  // Handle faults
  if (status === ChargePointStatus.FAULTED || errorCode !== ChargePointErrorCode.NO_ERROR) {
    await handleFault(chargerId, connectorId, status, errorCode, info);
  }

  // Update session status based on OCPP status transitions
  // Find active session for THIS specific connector
  const activeSession = await sessionService.getActiveSessionForConnector(chargerId, connectorId);
  if (activeSession) {
    const statusMapping = {
      [ChargePointStatus.CHARGING]: "CHARGING",
      [ChargePointStatus.FINISHING]: "FINISHING",
      [ChargePointStatus.SUSPENDED_EV]: "SUSPENDED",
      [ChargePointStatus.SUSPENDED_EVSE]: "SUSPENDED",
      [ChargePointStatus.FAULTED]: "FAULTED",
    };

    const newSessionStatus = statusMapping[status];
    if (newSessionStatus) {
      await sessionService.updateSessionStatus(activeSession.transactionId, newSessionStatus);
    }
  }

  // Handle finishing (charging completed, unplugged)
  if (status === ChargePointStatus.FINISHING) {
    console.log(`[STATUS] ${chargerId}#${connectorId}: Finishing - cable may be unplugged`);
  }

  // Handle available (ready for new session)
  if (status === ChargePointStatus.AVAILABLE) {
    console.log(`[STATUS] ${chargerId}#${connectorId}: Available for new session`);
  }
}

/**
 * Handle charger fault
 */
async function handleFault(chargerId, connectorId, status, errorCode, info) {
  console.warn(`⚠️ [FAULT] ${chargerId}#${connectorId}: ${errorCode} - ${info || 'No details'}`);

  // Check for active session on this specific connector
  const session = await sessionService.getActiveSessionForConnector(chargerId, connectorId);

  if (session) {
    // Emit fault event for billing to handle (partial refund, etc.)
    ocppEvents.emitSessionFaulted({
      chargerId,
      connectorId,
      transactionId: session.transactionId,
      errorCode,
      info,
    });
  }
}

/**
 * Update charger overall status (connectorId = 0)
 */
async function updateChargerOverallStatus(chargerId, status, errorCode) {
  try {
    await prisma.charger.updateMany({
      where: { id: chargerId },
      data: {
        status: mapStatus(status),
        lastSeen: new Date(),
      },
    });
  } catch (error) {
    console.error("Error updating charger overall status:", error);
  }
}

/**
 * Update connector status in database
 */
async function updateConnectorStatus(chargerId, connectorId, status, errorCode) {
  try {
    // Update or create connector
    await prisma.connector.upsert({
      where: {
        chargerId_connectorId: {
          chargerId,
          connectorId,
        },
      },
      create: {
        chargerId,
        connectorId,
        status: mapConnectorStatus(status),
        errorCode: errorCode !== ChargePointErrorCode.NO_ERROR ? errorCode : null,
      },
      update: {
        status: mapConnectorStatus(status),
        errorCode: errorCode !== ChargePointErrorCode.NO_ERROR ? errorCode : null,
      },
    });

    // Also update charger status based on aggregate connector state
    await updateChargerAggregateStatus(chargerId);
  } catch (error) {
    console.error("Error updating connector status:", error);
  }
}

/**
 * Compute aggregate charger status from all connectors.
 * Priority: FAULTED > CHARGING > PREPARING > RESERVED > FINISHING > SUSPENDED > AVAILABLE > UNAVAILABLE
 */
async function updateChargerAggregateStatus(chargerId) {
  try {
    const connectors = await prisma.connector.findMany({
      where: { chargerId },
      select: { status: true },
    });

    if (connectors.length === 0) return;

    const statusPriority = [
      "FAULTED", "CHARGING", "PREPARING", "RESERVED",
      "FINISHING", "SUSPENDED_EV", "SUSPENDED_EVSE", "AVAILABLE", "UNAVAILABLE",
    ];

    // Find the highest-priority status among all connectors
    let aggregateStatus = "UNAVAILABLE";
    for (const prio of statusPriority) {
      if (connectors.some(c => c.status === prio)) {
        aggregateStatus = prio;
        break;
      }
    }

    await prisma.charger.updateMany({
      where: { id: chargerId },
      data: {
        status: aggregateStatus,
        lastSeen: new Date(),
      },
    });
  } catch (error) {
    console.error("Error updating aggregate charger status:", error);
  }
}

/**
 * Map OCPP status to Prisma enum
 */
function mapStatus(ocppStatus) {
  const mapping = {
    [ChargePointStatus.AVAILABLE]: "AVAILABLE",
    [ChargePointStatus.PREPARING]: "PREPARING",
    [ChargePointStatus.CHARGING]: "CHARGING",
    [ChargePointStatus.SUSPENDED_EVSE]: "SUSPENDED_EVSE",
    [ChargePointStatus.SUSPENDED_EV]: "SUSPENDED_EV",
    [ChargePointStatus.FINISHING]: "FINISHING",
    [ChargePointStatus.RESERVED]: "RESERVED",
    [ChargePointStatus.UNAVAILABLE]: "UNAVAILABLE",
    [ChargePointStatus.FAULTED]: "FAULTED",
  };

  return mapping[ocppStatus] || "UNAVAILABLE";
}

/**
 * Map OCPP status to Connector Prisma enum
 */
function mapConnectorStatus(ocppStatus) {
  return mapStatus(ocppStatus); // Same mapping for now
}
