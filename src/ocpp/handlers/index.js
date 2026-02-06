import { sendCallResult, sendCallError } from "../messageQueue.js";
import { ErrorCode, CPtoCSAction } from "../ocppConstants.js";

// Import handlers
import bootNotification from "./bootNotification.js";
import heartbeat from "./heartbeat.js";
import authorize from "./authorize.js";
import statusNotification from "./statusNotification.js";
import startTransaction from "./startTransaction.js";
import stopTransaction from "./stopTransaction.js";
import meterValues from "./meterValues.js";
import dataTransfer from "./dataTransfer.js";
import diagnosticsStatusNotification from "./diagnosticsStatusNotification.js";
import firmwareStatusNotification from "./firmwareStatusNotification.js";
import changeConfiguration from "./changeConfiguration.js";
import getConfiguration from "./getConfiguration.js";
import clearCache from "./clearCache.js";
// import remoteStartTransaction from "./remoteStartTransaction.js"; // From CP
// import remoteStopTransaction from "./remoteStopTransaction.js"; // From CP
import unlockConnector from "./unlockConnector.js";
import getDiagnostics from "./getDiagnostics.js";
import updateFirmware from "./updateFirmware.js";
import changeAvailability from "./changeAvailability.js";
import reset from "./reset.js";
import triggerMessage from "./triggerMessage.js";
import getLocalListVersion from "./getLocalListVersion.js";
import sendLocalList from "./sendLocalList.js";
import setChargingProfile from "./setChargingProfile.js";
import clearChargingProfile from "./clearChargingProfile.js";
import getCompositeSchedule from "./getCompositeSchedule.js";

/**
 * OCPP Message Handler Router
 * 
 * Routes incoming OCPP CALL messages to appropriate handlers.
 * All handlers receive: (ws, messageId, chargerId, payload)
 */

// Handler registry
const handlers = {
  // Core messages (already implemented)
  [CPtoCSAction.BOOT_NOTIFICATION]: bootNotification,
  [CPtoCSAction.HEARTBEAT]: heartbeat,
  [CPtoCSAction.AUTHORIZE]: authorize,
  [CPtoCSAction.STATUS_NOTIFICATION]: statusNotification,
  [CPtoCSAction.START_TRANSACTION]: startTransaction,
  [CPtoCSAction.STOP_TRANSACTION]: stopTransaction,
  [CPtoCSAction.METER_VALUES]: meterValues,
  [CPtoCSAction.DATA_TRANSFER]: dataTransfer,
  
  // Firmware & Diagnostics
  [CPtoCSAction.DIAGNOSTICS_STATUS_NOTIFICATION]: diagnosticsStatusNotification,
  [CPtoCSAction.FIRMWARE_STATUS_NOTIFICATION]: firmwareStatusNotification,
  
  // Configuration
  [CPtoCSAction.GET_CONFIGURATION]: getConfiguration,
  [CPtoCSAction.CHANGE_CONFIGURATION]: changeConfiguration,
  [CPtoCSAction.CLEAR_CACHE]: clearCache,
  
  // Remote Transaction (from Charge Point)
  // [CPtoCSAction.REMOTE_START_TRANSACTION]: remoteStartTransaction,
  // [CPtoCSAction.REMOTE_STOP_TRANSACTION]: remoteStopTransaction,
  
  // Security
  [CPtoCSAction.GET_LOCAL_LIST_VERSION]: getLocalListVersion,
  [CPtoCSAction.SEND_LOCAL_LIST]: sendLocalList,
  
  // Charger Control
  [CPtoCSAction.UNLOCK_CONNECTOR]: unlockConnector,
  [CPtoCSAction.GET_DIAGNOSTICS]: getDiagnostics,
  [CPtoCSAction.UPDATE_FIRMWARE]: updateFirmware,
  [CPtoCSAction.CHANGE_AVAILABILITY]: changeAvailability,
  [CPtoCSAction.RESET]: reset,
  [CPtoCSAction.TRIGGER_MESSAGE]: triggerMessage,
  
  // Smart Charging (OCPP 1.6)
  [CPtoCSAction.SET_CHARGING_PROFILE]: setChargingProfile,
  [CPtoCSAction.CLEAR_CHARGING_PROFILE]: clearChargingProfile,
  [CPtoCSAction.GET_COMPOSITE_SCHEDULE]: getCompositeSchedule,
};

/**
 * Handle incoming OCPP message
 * 
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} chargerId - Charger identifier
 * @param {string} messageId - OCPP message ID
 * @param {string} action - OCPP action name
 * @param {object} payload - Message payload
 */
export async function handleOcppMessage(ws, chargerId, messageId, action, payload) {

    // 🔹 LOG EVERYTHING FROM CHARGER
  console.log("=================================");
  console.log(`📥 OCPP MESSAGE FROM CP`);
  console.log(`Charger: ${chargerId}`);
  console.log(`Action : ${action}`);
  console.log(`Msg ID : ${messageId}`);
  console.log(`Payload:`, JSON.stringify(payload, null, 2));
  console.log("=================================");

  const handler = handlers[action];

  if (!handler) {
    console.warn(`⚠️ Unknown OCPP action: ${action} from ${chargerId}`);
    sendCallError(
      ws,
      messageId,
      ErrorCode.NOT_IMPLEMENTED,
      `Action ${action} is not implemented`
    );
    return;
  }

  try {
    await handler(ws, messageId, chargerId, payload);
  } catch (error) {
    console.error(`❌ Handler error for ${action} from ${chargerId}:`, error);
    sendCallError(
      ws,
      messageId,
      ErrorCode.INTERNAL_ERROR,
      error.message
    );
  }
}

/**
 * Handle DiagnosticsStatusNotification
 * Simple acknowledgment - just log and respond
 */
async function handleDiagnosticsStatus(ws, messageId, chargerId, payload) {
  console.log(`[DIAG] ${chargerId}: ${payload.status}`);
  sendCallResult(ws, messageId, {});
}

/**
 * Handle FirmwareStatusNotification
 * Simple acknowledgment - just log and respond
 */
async function handleFirmwareStatus(ws, messageId, chargerId, payload) {
  console.log(`[FW] ${chargerId}: ${payload.status}`);
  sendCallResult(ws, messageId, {});
}

export default { handleOcppMessage };
