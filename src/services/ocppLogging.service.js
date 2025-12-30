import prisma from "../config/db.js";

/**
 * OCPP Message Logging Service
 * 
 * Records all OCPP messages for audit and debugging purposes.
 * Messages are stored immutably for regulatory compliance.
 */

/**
 * Log an incoming OCPP message (CP → CS)
 * 
 * @param {string} chargerId
 * @param {array} message - Raw OCPP message array
 * @returns {Promise<object>}
 */
export async function logIncomingMessage(chargerId, message) {
  const [messageType, messageId, ...rest] = message;
  
  let action = null;
  let payload = null;
  let errorCode = null;
  let errorDescription = null;

  if (messageType === 2) {
    // CALL: [2, messageId, action, payload]
    action = rest[0];
    payload = rest[1];
  } else if (messageType === 3) {
    // CALLRESULT: [3, messageId, payload]
    payload = rest[0];
  } else if (messageType === 4) {
    // CALLERROR: [4, messageId, errorCode, errorDescription, errorDetails]
    errorCode = rest[0];
    errorDescription = rest[1];
    payload = rest[2];
  }

  try {
    return await prisma.ocppMessageLog.create({
      data: {
        chargerId,
        direction: "INCOMING",
        messageType,
        messageId,
        action,
        payload: JSON.stringify(payload),
        errorCode,
        errorDescription,
      },
    });
  } catch (error) {
    console.error("Failed to log incoming OCPP message:", error);
    // Don't throw - logging should not fail the main operation
    return null;
  }
}

/**
 * Log an outgoing OCPP message (CS → CP)
 * 
 * @param {string} chargerId
 * @param {array} message - Raw OCPP message array
 * @returns {Promise<object>}
 */
export async function logOutgoingMessage(chargerId, message) {
  const [messageType, messageId, ...rest] = message;
  
  let action = null;
  let payload = null;
  let errorCode = null;
  let errorDescription = null;

  if (messageType === 2) {
    // CALL: [2, messageId, action, payload]
    action = rest[0];
    payload = rest[1];
  } else if (messageType === 3) {
    // CALLRESULT: [3, messageId, payload]
    payload = rest[0];
  } else if (messageType === 4) {
    // CALLERROR: [4, messageId, errorCode, errorDescription, errorDetails]
    errorCode = rest[0];
    errorDescription = rest[1];
    payload = rest[2];
  }

  try {
    return await prisma.ocppMessageLog.create({
      data: {
        chargerId,
        direction: "OUTGOING",
        messageType,
        messageId,
        action,
        payload: JSON.stringify(payload),
        errorCode,
        errorDescription,
      },
    });
  } catch (error) {
    console.error("Failed to log outgoing OCPP message:", error);
    return null;
  }
}

/**
 * Update log with response (for tracking round-trip time)
 * 
 * @param {string} messageId
 * @param {object} response
 * @param {number} responseTimeMs
 */
export async function updateLogWithResponse(messageId, response, responseTimeMs) {
  try {
    await prisma.ocppMessageLog.updateMany({
      where: { messageId },
      data: {
        response: JSON.stringify(response),
        responseTime: responseTimeMs,
      },
    });
  } catch (error) {
    console.error("Failed to update OCPP log with response:", error);
  }
}

/**
 * Get message statistics for a charger
 * 
 * @param {string} chargerId
 * @param {Date} since - Since when to calculate stats
 */
export async function getMessageStats(chargerId, since = null) {
  const where = { chargerId };
  if (since) {
    where.timestamp = { gte: since };
  }

  const messages = await prisma.ocppMessageLog.groupBy({
    by: ["action", "direction"],
    where,
    _count: { id: true },
  });

  const errorCount = await prisma.ocppMessageLog.count({
    where: {
      ...where,
      messageType: 4, // CALLERROR
    },
  });

  return {
    messageCounts: messages,
    errorCount,
  };
}

export default {
  logIncomingMessage,
  logOutgoingMessage,
  updateLogWithResponse,
  getMessageStats,
};

