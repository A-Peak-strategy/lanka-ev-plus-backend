import { sendCall } from "../messageQueue.js";
import { CStoCPAction, RemoteStartStopStatus } from "../ocppConstants.js";
import { getChargerConnection, isChargerOnline } from "../ocppServer.js";

/**
 * RemoteStartTransaction Command
 * 
 * Sent by Central System to start a charging session remotely.
 * 
 * Request: {
 *   connectorId?: number,
 *   idTag: string,
 *   chargingProfile?: ChargingProfile
 * }
 * 
 * Response: {
 *   status: "Accepted" | "Rejected"
 * }
 */

/**
 * Send RemoteStartTransaction to a charger
 * 
 * @param {string} chargerId - Target charger ID
 * @param {object} options - Command options
 * @param {string} options.idTag - User identifier (RFID, userId, etc.)
 * @param {number} options.connectorId - Specific connector (optional)
 * @param {object} options.chargingProfile - Charging profile (optional)
 * @returns {Promise<object>} Command result
 */
export async function remoteStartTransaction(chargerId, options) {
  const { idTag, connectorId, chargingProfile } = options;

  if (!idTag) {
    throw new Error("idTag is required for RemoteStartTransaction");
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

  // Build payload
  const payload = {
    idTag,
  };

  if (connectorId !== undefined) {
    payload.connectorId = connectorId;
  }

  if (chargingProfile) {
    payload.chargingProfile = chargingProfile;
  }

  try {
    console.log(`[CMD] RemoteStartTransaction → ${chargerId} (idTag: ${idTag})`);

    const response = await sendCall(
      ws,
      chargerId,
      CStoCPAction.REMOTE_START_TRANSACTION,
      payload,
      { timeout: 30000 }
    );

    const accepted = response.status === RemoteStartStopStatus.ACCEPTED;

    console.log(`[CMD] RemoteStartTransaction ← ${chargerId}: ${JSON.stringify(response)}`);

    return {
      success: accepted,
      status: response.status,
      chargerId,
      idTag,
      connectorId,
    };
  } catch (error) {
    console.error(`[CMD] RemoteStartTransaction error for ${chargerId}:`, error.message);
    return {
      success: false,
      status: "Error",
      error: error.message,
    };
  }
}

/**
 * Start charging for a user at a specific charger
 * 
 * High-level function that handles user lookup and starts charging
 * 
 * @param {object} params
 * @param {string} params.chargerId - Charger ID
 * @param {string} params.userId - User ID
 * @param {number} params.connectorId - Connector ID (optional, defaults to 1)
 * @returns {Promise<object>}
 */
export async function startChargingForUser(params) {
  const { chargerId, userId, connectorId = 1, presetAmount } = params;

  // OCPP 1.6 CiString20Type: idTag max 20 characters
  // User IDs (CUIDs) can be ~25 chars, so truncate for OCPP compliance.
  const idTag = userId.substring(0, 20);

  // Store the full userId directly in the in-memory charger store.
  // IMPORTANT: We use the Map directly because updateChargerState() writes
  // to the DB via chargerRuntimeState which has a field whitelist that
  // silently drops unknown fields like pendingUserId.
  const { chargersStore, getChargerKey } = await import("../../services/chargerStore.service.js");
  const key = getChargerKey(chargerId, connectorId);
  const currentState = chargersStore.get(key) || {};
  chargersStore.set(key, {
    ...currentState,
    pendingUserId: userId,
    pendingPresetAmount: presetAmount || null,
  });

  console.log(`[CMD] Stored pendingUserId for ${chargerId}: ${userId}${presetAmount ? `, presetAmount: LKR ${presetAmount}` : ''}`);

  return remoteStartTransaction(chargerId, {
    idTag,
    connectorId,
  });
}

export default {
  remoteStartTransaction,
  startChargingForUser,
};

