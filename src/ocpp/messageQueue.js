import { v4 as uuidv4 } from "uuid";
import { MessageType, ErrorCode } from "./ocppConstants.js";
import ocppLoggingService from "../services/ocppLogging.service.js";

/**
 * OCPP Message Queue
 * 
 * Manages outgoing messages from Central System to Charge Points.
 * Features:
 * - Message ID tracking
 * - Callback handling for responses
 * - Timeout management
 * - Message logging for audit
 */

// Pending messages waiting for response
const pendingMessages = new Map();

// Default timeout for responses (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Send OCPP CALL message to charger and wait for response
 * 
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} chargerId - Charger identifier
 * @param {string} action - OCPP action name
 * @param {object} payload - Message payload
 * @param {object} options - Options (timeout, etc.)
 * @returns {Promise<object>} Response payload
 */
export async function sendCall(ws, chargerId, action, payload, options = {}) {
  const messageId = options.messageId || uuidv4();
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    // Create timeout handler
    const timeoutId = setTimeout(() => {
      pendingMessages.delete(messageId);
      logMessage(chargerId, "TIMEOUT", action, messageId, payload, null);
      reject(new Error(`OCPP request timeout: ${action} (${messageId})`));
    }, timeout);

    // Store pending message with callbacks
    pendingMessages.set(messageId, {
      action,
      chargerId,
      timestamp: Date.now(),
      timeoutId,
      resolve: (response) => {
        clearTimeout(timeoutId);
        pendingMessages.delete(messageId);
        logMessage(chargerId, "RESPONSE", action, messageId, payload, response);
        resolve(response);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        pendingMessages.delete(messageId);
        logMessage(chargerId, "ERROR", action, messageId, payload, error);
        reject(error);
      },
    });

    // Build OCPP CALL message [MessageType, MessageId, Action, Payload]
    const message = [MessageType.CALL, messageId, action, payload];

    try {
      ws.send(JSON.stringify(message));
      logMessage(chargerId, "CALL", action, messageId, payload, null);
    } catch (error) {
      clearTimeout(timeoutId);
      pendingMessages.delete(messageId);
      reject(error);
    }
  });
}

/**
 * Send OCPP CALL message without waiting for response (fire and forget)
 * 
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} chargerId - Charger identifier
 * @param {string} action - OCPP action name
 * @param {object} payload - Message payload
 * @returns {string} Message ID
 */
export function sendCallNoWait(ws, chargerId, action, payload) {
  const messageId = uuidv4();
  const message = [MessageType.CALL, messageId, action, payload];

  try {
    ws.send(JSON.stringify(message));
    logMessage(chargerId, "CALL", action, messageId, payload, null);
    return messageId;
  } catch (error) {
    console.error(`Failed to send ${action} to ${chargerId}:`, error.message);
    throw error;
  }
}

/**
 * Handle incoming CALLRESULT message
 * 
 * @param {string} messageId - Original message ID
 * @param {object} payload - Response payload
 * @returns {boolean} Whether message was handled
 */
export function handleCallResult(messageId, payload) {
  const pending = pendingMessages.get(messageId);

  if (!pending) {
    console.warn(`Received CALLRESULT for unknown message: ${messageId}`);
    return false;
  }

  pending.resolve(payload);
  return true;
}

/**
 * Handle incoming CALLERROR message
 * 
 * @param {string} messageId - Original message ID
 * @param {string} errorCode - OCPP error code
 * @param {string} errorDescription - Error description
 * @param {object} errorDetails - Additional error details
 * @returns {boolean} Whether message was handled
 */
export function handleCallError(messageId, errorCode, errorDescription, errorDetails) {
  const pending = pendingMessages.get(messageId);

  if (!pending) {
    console.warn(`Received CALLERROR for unknown message: ${messageId}`);
    return false;
  }

  pending.reject({
    code: errorCode,
    description: errorDescription,
    details: errorDetails,
  });

  return true;
}

/**
 * Send OCPP CALLRESULT (response) message
 * 
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} messageId - Original message ID
 * @param {object} payload - Response payload
 */
export function sendCallResult(ws, messageId, payload) {
  const message = [MessageType.CALLRESULT, messageId, payload];
  ws.send(JSON.stringify(message));
}

/**
 * Send OCPP CALLERROR message
 * 
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} messageId - Original message ID
 * @param {string} errorCode - OCPP error code
 * @param {string} errorDescription - Error description
 * @param {object} errorDetails - Additional details
 */
export function sendCallError(ws, messageId, errorCode, errorDescription, errorDetails = {}) {
  const message = [
    MessageType.CALLERROR,
    messageId,
    errorCode,
    errorDescription,
    errorDetails,
  ];
  ws.send(JSON.stringify(message));
}

/**
 * Cancel all pending messages for a charger (e.g., on disconnect)
 * 
 * @param {string} chargerId - Charger identifier
 */
export function cancelPendingMessages(chargerId) {
  for (const [messageId, pending] of pendingMessages.entries()) {
    if (pending.chargerId === chargerId) {
      pending.reject(new Error("Charger disconnected"));
    }
  }
}

/**
 * Get pending message count for debugging
 */
export function getPendingMessageCount() {
  return pendingMessages.size;
}

/**
 * Log OCPP message for audit
 * 
 * @param {string} chargerId
 * @param {string} direction - CALL, RESPONSE, ERROR, TIMEOUT
 * @param {string} action
 * @param {string} messageId
 * @param {object} payload
 * @param {object} response
 */
async function logMessage(chargerId, direction, action, messageId, payload, response) {
  const timestamp = new Date().toISOString();
  
  // Console logging
  const arrow = direction === "CALL" ? "→" : "←";
  console.log(`[OCPP] ${timestamp} ${chargerId} ${arrow} ${action} (${messageId})`);

  // Database logging (async, non-blocking)
  try {
    if (direction === "CALL") {
      // Log outgoing CALL message
      await ocppLoggingService.logOutgoingMessage(chargerId, [
        MessageType.CALL,
        messageId,
        action,
        payload,
      ]);
    } else if (direction === "RESPONSE" && response) {
      // Update original log with response
      const responseTimeMs = Date.now() - (pendingMessages.get(messageId)?.timestamp || Date.now());
      await ocppLoggingService.updateLogWithResponse(messageId, response, responseTimeMs);
    } else if (direction === "ERROR" && response) {
      // Log error response
      await ocppLoggingService.updateLogWithResponse(messageId, {
        error: response.code,
        description: response.description,
        details: response.details,
      }, 0);
    }
  } catch (error) {
    // Don't fail on logging errors
    console.error("Failed to log OCPP message:", error.message);
  }
}

export default {
  sendCall,
  sendCallNoWait,
  handleCallResult,
  handleCallError,
  sendCallResult,
  sendCallError,
  cancelPendingMessages,
  getPendingMessageCount,
};

