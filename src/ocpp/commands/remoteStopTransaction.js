import { sendCall } from "../messageQueue.js";
import { CStoCPAction, RemoteStartStopStatus } from "../ocppConstants.js";
import { getChargerConnection, isChargerOnline } from "../ocppServer.js";
import { getConnectorState, getAllConnectorStates } from "../../services/chargerStore.service.js";
import prisma from "../../config/db.js";

/**
 * RemoteStopTransaction Command
 * 
 * Sent by Central System to stop a charging session remotely.
 * 
 * Now supports stopping a specific connector's session on
 * multi-connector chargers.
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

  // 1. If input is already an integer, use directly
  if (typeof transactionIdOrInternal === "number") {
    ocppTxId = transactionIdOrInternal;
  } else {
    // 2. Try to find from connector states
    const connMap = await getAllConnectorStates(chargerId);
    if (connMap && connMap.size > 0) {
      for (const [, state] of connMap) {
        if (state?.ocppTransactionId && (
          state.transactionId === transactionIdOrInternal ||
          state.ocppTransactionId === transactionIdOrInternal
        )) {
          ocppTxId = state.ocppTransactionId;
          break;
        }
      }
    }

    // 3. DB lookup
    if (!ocppTxId) {
      const session = await prisma.chargingSession.findUnique({
        where: { transactionId: transactionIdOrInternal },
        select: { id: true },
      });
      if (session) {
        ocppTxId = session.id;
      } else {
        // Last resort: try to parse as integer
        ocppTxId = parseInt(transactionIdOrInternal);
        if (isNaN(ocppTxId)) {
          return {
            success: false,
            status: "Error",
            error: `Cannot resolve OCPP transactionId from: ${transactionIdOrInternal}`,
          };
        }
      }
    }
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
 * Stop charging on a specific connector of a charger.
 * 
 * @param {string} chargerId - Charger ID
 * @param {number} connectorId - Connector to stop
 * @returns {Promise<object>}
 */
export async function stopChargingAtConnector(chargerId, connectorId) {
  const connState = await getConnectorState(chargerId, connectorId);

  if (!connState?.ocppTransactionId && !connState?.transactionId) {
    // Try DB
    const session = await prisma.chargingSession.findFirst({
      where: {
        chargerId,
        endedAt: null,
        connector: { connectorId },
      },
      orderBy: { startedAt: "desc" },
    });

    if (!session) {
      return {
        success: false,
        status: "NoActiveSession",
        error: `No active charging session on connector ${connectorId}`,
      };
    }

    return remoteStopTransaction(chargerId, session.id);
  }

  return remoteStopTransaction(chargerId, connState.ocppTransactionId || connState.transactionId);
}

/**
 * Stop charging at a charger (finds first active connector).
 * Backward-compat: if connectorId not specified, stops first active session found.
 * 
 * @param {string} chargerId - Charger ID
 * @param {number} [connectorId] - Optional connector to stop
 * @returns {Promise<object>}
 */
export async function stopChargingAtCharger(chargerId, connectorId) {
  // If specific connector requested, use targeted stop
  if (connectorId) {
    return stopChargingAtConnector(chargerId, connectorId);
  }

  // Search all connectors for an active session
  const connMap = await getAllConnectorStates(chargerId);
  if (connMap && connMap.size > 0) {
    for (const [connId, state] of connMap) {
      if (state?.ocppTransactionId || state?.transactionId) {
        console.log(`[CMD] Found active session on connector ${connId}`);
        return remoteStopTransaction(chargerId, state.ocppTransactionId || state.transactionId);
      }
    }
  }

  // Fallback: DB search
  const session = await prisma.chargingSession.findFirst({
    where: {
      chargerId,
      endedAt: null,
    },
    orderBy: { startedAt: "desc" },
  });

  if (!session) {
    return {
      success: false,
      status: "NoActiveSession",
      error: "No active charging session found",
    };
  }

  return remoteStopTransaction(chargerId, session.id);
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
  stopChargingAtConnector,
  forceStopForGrace,
};
