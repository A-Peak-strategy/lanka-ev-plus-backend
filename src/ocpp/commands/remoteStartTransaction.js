import { sendCall } from "../messageQueue.js";
import { CStoCPAction, RemoteStartStopStatus } from "../ocppConstants.js";
import { getChargerConnection, isChargerOnline } from "../ocppServer.js";
import { chargersStore, getChargerKey } from "../../services/chargerStore.service.js";

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
  const key = getChargerKey(chargerId, connectorId);
  const currentState = chargersStore.get(key) || {};
  chargersStore.set(key, {
    ...currentState,
    pendingUserId: userId,
    pendingPresetAmount: presetAmount || null,
  });

  console.log(`[CMD] Stored pendingUserId for ${chargerId}: ${userId}${presetAmount ? `, presetAmount: LKR ${presetAmount}` : ''}`);

  const result = await remoteStartTransaction(chargerId, {
    idTag,
    connectorId,
  });

  if (!result.success) {
    clearPendingStartWatchdog(chargerId, connectorId);
    clearPendingStartState(chargerId, connectorId);
  }

  if (result.success) {
    schedulePendingStartWatchdog(chargerId, connectorId, userId, presetAmount);
  }

  return result;
}

const startWatchdogs = new Map();

function getWatchdogKey(chargerId, connectorId) {
  return `${chargerId}:${connectorId}`;
}

export function clearPendingStartWatchdog(chargerId, connectorId) {
  const key = getWatchdogKey(chargerId, connectorId);
  const timeout = startWatchdogs.get(key);
  if (timeout) {
    clearTimeout(timeout);
    startWatchdogs.delete(key);
  }
}

export function clearPendingStartState(chargerId, connectorId) {
  const key = getChargerKey(chargerId, connectorId);
  const currentState = chargersStore.get(key);
  if (!currentState) return;

  const nextState = {
    ...currentState,
    pendingUserId: null,
    pendingPresetAmount: null,
  };

  chargersStore.set(key, nextState);
}

export function schedulePendingStartWatchdog(chargerId, connectorId, userId, presetAmount) {
  const key = getWatchdogKey(chargerId, connectorId);
  clearPendingStartWatchdog(chargerId, connectorId);

  const timeout = setTimeout(async () => {
    startWatchdogs.delete(key);

    const cacheKey = getChargerKey(chargerId, connectorId);
    const cachedState = chargersStore.get(cacheKey);

    if (!cachedState?.pendingUserId || cachedState.pendingUserId !== userId) {
      return;
    }

    if (!cachedState.pendingPresetAmount) {
      clearPendingStartState(chargerId, connectorId);
      return;
    }

    try {
      const walletService = await import("../../services/wallet.service.js");
      await walletService.unlockFunds(userId, cachedState.pendingPresetAmount);
      console.log(`[START WATCHDOG] Released locked funds for ${chargerId}#${connectorId} after stale remote start`);
    } catch (error) {
      console.error(`[START WATCHDOG] Failed to release locked funds for ${chargerId}#${connectorId}:`, error.message);
    }

    clearPendingStartState(chargerId, connectorId);
  }, 90000);

  startWatchdogs.set(key, timeout);
}

export default {
  remoteStartTransaction,
  startChargingForUser,
};

