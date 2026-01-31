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
 * @param {string} chargerId - Target charger ID
 * @param {string|number} transactionId - Transaction to stop
 * @returns {Promise<object>} Command result
 */
export async function remoteStopTransaction(chargerId, transactionId) {



  if (!transactionId) {
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

  // OCPP 1.6 expects transactionId as integer
  // Some chargers accept string, others require integer
  const txId = typeof transactionId === "string" 
    ? parseInt(transactionId) || transactionId 
    : transactionId;

  try {
    console.log(`[CMD] RemoteStopTransaction → ${chargerId} (txId: ${transactionId})`);

    const response = await sendCall(
      ws,
      chargerId,
      CStoCPAction.REMOTE_STOP_TRANSACTION,
      { transactionId: txId },
      { timeout: 30000 }
    );

    console.log("Response from the charger : >>>>>>>>>>>>>>>>>>>>>>>>>", response);

    const accepted = response.status === RemoteStartStopStatus.ACCEPTED;

    console.log(`[CMD] RemoteStopTransaction ← ${chargerId}: ${response.status}`);

    return {
      success: accepted,
      status: response.status,
      chargerId,
      transactionId,
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
 * Stop charging at a specific charger
 * 
 * High-level function that finds active transaction and stops it
 * 
 * @param {string} chargerId - Charger ID
 * @returns {Promise<object>}
 */
export async function stopChargingAtCharger(chargerId) {
  // Get active transaction from charger state
  const chargerState = getChargerState(chargerId);
  
  if (!chargerState?.transactionId) {
    // Try to find from database
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

    return remoteStopTransaction(chargerId, session.transactionId);
  }

  return remoteStopTransaction(chargerId, chargerState.transactionId);
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

  // Update session with stop reason if successful
  if (result.success) {
    try {
      await prisma.chargingSession.updateMany({
        where: { transactionId },
        data: { stopReason: "GRACE_EXPIRED" },
      });
    } catch (error) {
      console.error("Error updating session stop reason:", error);
    }
  }

  return result;
}

export default {
  remoteStopTransaction,
  stopChargingAtCharger,
  forceStopForGrace,
};

