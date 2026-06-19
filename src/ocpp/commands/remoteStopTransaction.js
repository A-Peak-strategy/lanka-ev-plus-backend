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
// Lightweight tracking of active retry loops
const activeStopRetries = new Set();

/**
 * Direct function to send RemoteStopTransaction without registering the retry watchdog
 */
export async function remoteStopTransactionDirect(chargerId, transactionIdOrInternal) {
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
 * Queue a retry watchdog for a failed remote stop transaction.
 * Optimized for performance: limits to 3 attempts at 60s intervals.
 */
export function queueStopTransactionRetry(chargerId, transactionIdOrInternal, attempt = 1) {
  const retryKey = `${chargerId}:${transactionIdOrInternal}`;
  if (activeStopRetries.has(retryKey)) {
    return; // Already has an active retry watchdog
  }

  activeStopRetries.add(retryKey);

  const maxAttempts = 3;
  const intervalMs = 30000; // 60 seconds

  async function checkAndRetry() {
    try {
      // 1. Check if session has already ended in the database
      let session = null;
      if (typeof transactionIdOrInternal === "number") {
        session = await prisma.chargingSession.findUnique({
          where: { id: transactionIdOrInternal },
          select: { endedAt: true }
        });
      } else {
        session = await prisma.chargingSession.findUnique({
          where: { transactionId: transactionIdOrInternal },
          select: { endedAt: true }
        });
      }

      if (!session || session.endedAt) {
        console.log(`[STOP-WATCHDOG] Session ${transactionIdOrInternal} is already ended. Stopping watchdog.`);
        activeStopRetries.delete(retryKey);
        return;
      }

      if (attempt > maxAttempts) {
        console.warn(`[STOP-WATCHDOG] Reached max attempts (${maxAttempts}) for session ${transactionIdOrInternal} on charger ${chargerId}. Giving up.`);
        activeStopRetries.delete(retryKey);
        return;
      }

      // 2. Performance Check: Memory check if charger is online first
      if (!isChargerOnline(chargerId)) {
        console.log(`[STOP-WATCHDOG] Charger ${chargerId} is offline. Postponing attempt ${attempt}/${maxAttempts} (will retry later).`);
        activeStopRetries.delete(retryKey);
        setTimeout(() => queueStopTransactionRetry(chargerId, transactionIdOrInternal, attempt + 1), intervalMs);
        return;
      }

      console.log(`[STOP-WATCHDOG] Attempt ${attempt}/${maxAttempts} to stop session ${transactionIdOrInternal} on charger ${chargerId}`);
      
      const result = await remoteStopTransactionDirect(chargerId, transactionIdOrInternal);
      console.log(`[STOP-WATCHDOG] Result for attempt ${attempt}:`, result);

      if (result.success) {
        console.log(`[STOP-WATCHDOG] Successfully sent remote stop to charger ${chargerId} on attempt ${attempt}.`);
        activeStopRetries.delete(retryKey);
        return;
      }
    } catch (err) {
      console.error(`[STOP-WATCHDOG] Error on attempt ${attempt}:`, err.message);
    }

    activeStopRetries.delete(retryKey);
    setTimeout(() => queueStopTransactionRetry(chargerId, transactionIdOrInternal, attempt + 1), intervalMs);
  }

  // Schedule the first retry after the interval
  setTimeout(checkAndRetry, intervalMs);
}

/**
 * Send RemoteStopTransaction to a charger
 * 
 * IMPORTANT: Per OCPP 1.6 Section 6.35, transactionId MUST be integer.
 * This function accepts the internal string transactionId OR the OCPP integer ID,
 * and resolves the correct integer to send to the charger.
 * 
 * Automatically registers an optimized background watchdog if the initial stop attempt fails.
 * 
 * @param {string} chargerId - Target charger ID
 * @param {string|number} transactionIdOrInternal - OCPP integer txId or internal string txId
 * @returns {Promise<object>} Command result
 */
export async function remoteStopTransaction(chargerId, transactionIdOrInternal) {
  const result = await remoteStopTransactionDirect(chargerId, transactionIdOrInternal);

  // ALWAYS queue a watchdog to confirm that the session actually ended in the database.
  // The watchdog will check session.endedAt, and if it's still active (not stopped),
  // it will retry the stop command.
  console.log(`[CMD] Registering background watchdog for session ${transactionIdOrInternal} on charger ${chargerId} to confirm stop`);
  queueStopTransactionRetry(chargerId, transactionIdOrInternal);

  return result;
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

