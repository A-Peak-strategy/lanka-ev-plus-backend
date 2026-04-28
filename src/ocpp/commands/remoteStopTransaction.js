import { sendCall } from "../messageQueue.js";
import { CStoCPAction, RemoteStartStopStatus } from "../ocppConstants.js";
import { getChargerConnection, isChargerOnline } from "../ocppServer.js";
import { getChargerState } from "../../services/chargerStore.service.js";
import prisma from "../../config/db.js";

/**
 * RemoteStopTransaction Command
 * 
 * Sent by Central System to stop a charging session remotely.
 * 
 * Request: {
 *   transactionId: number
 * }
 * 
 * Response: {
 *   status: "Accepted" | "Rejected"
 * }
 */

/**
 * Send RemoteStopTransaction to a charger
 * 
 * IMPORTANT: Per OCPP 1.6 Section 6.35, transactionId MUST be integer.
 * This function accepts the internal string transactionId OR the OCPP integer ID,
 * and resolves the correct integer to send to the charger.
 * 
 * @param {string} chargerId - Target charger ID
 * @param {string|number} transactionIdOrInternal - OCPP integer txId or internal string txId
 * @returns {Promise<object>} Command result
 */
export async function remoteStopTransaction(chargerId, transactionIdOrInternal) {
  if (!transactionIdOrInternal) {
    throw new Error("transactionId is required for RemoteStopTransaction");
  }

  // Check if charger is online
  if (!isChargerOnline(chargerId)) {
    return {
      success: false,
      status: "Offline",
      error: "Charger is not connected",
    };
  }

  const ws = getChargerConnection(chargerId);

  // Resolve the OCPP integer transactionId
  let ocppTxId;

  // 1. If input is already a number, trust it as the OCPP ID
  if (typeof transactionIdOrInternal === "number") {
    ocppTxId = transactionIdOrInternal;
  } 
  // 2. If it's a string, try to find the session to get the integer ID
  else {
    const session = await prisma.chargingSession.findUnique({
      where: { transactionId: transactionIdOrInternal },
      select: { id: true },
    });
    
    if (session) {
      ocppTxId = session.id;
    } else {
      // 3. Fallback: check memory (may be inaccurate if multiple connectors)
      const chargerState = await getChargerState(chargerId);
      if (chargerState?.ocppTransactionId) {
        ocppTxId = chargerState.ocppTransactionId;
      } else {
        // Last resort: parse string as integer
        ocppTxId = parseInt(transactionIdOrInternal);
      }
    }
  }

  if (!ocppTxId || isNaN(ocppTxId)) {
    return {
      success: false,
      status: "Error",
      error: `Cannot resolve OCPP transactionId from: ${transactionIdOrInternal}`,
    };
  }

  try {
    console.log(`[CMD] RemoteStopTransaction → ${chargerId} (ocppTxId: ${ocppTxId})`);

    const response = await sendCall(
      ws,
      chargerId,
      CStoCPAction.REMOTE_STOP_TRANSACTION,
      { transactionId: ocppTxId },
      { timeout: 30000 }
    );

    const accepted = response.status === RemoteStartStopStatus.ACCEPTED;
    console.log(`[CMD] RemoteStopTransaction ← ${chargerId}: ${response.status}`);

    return {
      success: accepted,
      status: response.status,
      chargerId,
      transactionId: transactionIdOrInternal,
      ocppTransactionId: ocppTxId,
    };
  } catch (error) {
    console.error(`[CMD] RemoteStopTransaction error for ${chargerId}:`, error.message);
    return {
      success: false,
      status: "Error",
      error: error.message,
    };
  }
}

/**
 * Stop charging at a specific charger/connector
 * 
 * High-level function that finds active transaction and stops it
 * 
 * @param {string} chargerId - Charger ID
 * @param {number} [connectorId] - Optional connector ID
 * @returns {Promise<object>}
 */
export async function stopChargingAtCharger(chargerId, connectorId = null) {
  // Get active transaction from charger state
  const chargerState = await getChargerState(chargerId, connectorId || 1);
  
  if (!chargerState?.ocppTransactionId && !chargerState?.transactionId) {
    // Try to find from database
    const where = {
      chargerId,
      endedAt: null,
    };

    if (connectorId) {
      const connector = await prisma.connector.findUnique({
        where: { chargerId_connectorId: { chargerId, connectorId: parseInt(connectorId) } }
      });
      if (connector) {
        where.connectorId = connector.id;
      }
    }

    const session = await prisma.chargingSession.findFirst({
      where,
      orderBy: { startedAt: "desc" },
    });

    if (!session) {
      return {
        success: false,
        status: "NoActiveSession",
        error: "No active charging session found",
      };
    }

    // session.id is the OCPP integer transactionId
    return remoteStopTransaction(chargerId, session.id);
  }

  // Prefer ocppTransactionId (integer), fall back to internal string
  return remoteStopTransaction(chargerId, chargerState.ocppTransactionId || chargerState.transactionId);
}

/**
 * Force stop for grace period expiry
 * 
 * @param {string} chargerId
 * @param {string} transactionId
 * @param {string} reason
 * @returns {Promise<object>}
 */
export async function forceStopForGrace(chargerId, transactionId, reason = "Grace period expired") {
  console.log(`[CMD] Force stopping ${transactionId} on ${chargerId}: ${reason}`);

  const result = await remoteStopTransaction(chargerId, transactionId);

  // Update session with stop reason regardless of charger response
  // (if charger is offline, the session still needs to be marked)
  try {
    await prisma.chargingSession.updateMany({
      where: { transactionId },
      data: { stopReason: "GRACE_EXPIRED" },
    });
  } catch (error) {
    console.error("Error updating session stop reason:", error);
  }

  return result;
}

export default {
  remoteStopTransaction,
  stopChargingAtCharger,
  forceStopForGrace,
};

