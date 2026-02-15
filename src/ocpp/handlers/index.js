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

/**
 * OCPP Message Handler Router
 * 
 * Routes incoming OCPP CALL messages to appropriate handlers.
 * All handlers receive: (ws, messageId, chargerId, payload)
 */

// Handler registry
const handlers = {
  [CPtoCSAction.BOOT_NOTIFICATION]: bootNotification,
  [CPtoCSAction.HEARTBEAT]: heartbeat,
  [CPtoCSAction.AUTHORIZE]: authorize,
  [CPtoCSAction.STATUS_NOTIFICATION]: statusNotification,
  [CPtoCSAction.START_TRANSACTION]: startTransaction,
  [CPtoCSAction.STOP_TRANSACTION]: stopTransaction,
  [CPtoCSAction.METER_VALUES]: meterValues,
  [CPtoCSAction.DATA_TRANSFER]: dataTransfer,
  [CPtoCSAction.DIAGNOSTICS_STATUS_NOTIFICATION]: handleDiagnosticsStatus,
  [CPtoCSAction.FIRMWARE_STATUS_NOTIFICATION]: handleFirmwareStatus,
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
