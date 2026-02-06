import { WebSocketServer } from "ws";
import { handleOcppMessage } from "./handlers/index.js";
import {
  cancelPendingMessages,
  handleCallResult,
  handleCallError,
} from "./messageQueue.js";
import { ocppEvents, setupEventListeners } from "./ocppEvents.js";
import { MessageType, ErrorCode } from "./ocppConstants.js";
import { sendCallError } from "./messageQueue.js";
import prisma from "../config/db.js";
import sessionService from "../services/session.service.js";
import ocppLoggingService from "../services/ocppLogging.service.js";
import {
  validateMessageStructure,
  validatePayload,
} from "./schemaValidator.js";

/**
 * OCPP 1.6 WebSocket Server
 *
 * Features:
 * - Charger identity validation
 * - Connection lifecycle management
 * - Message routing (CALL, CALLRESULT, CALLERROR)
 * - Session recovery after reconnection
 * - Event emission for internal systems
 */

// Active WebSocket connections by charger ID
export const chargers = new Map();

// Charger metadata
const chargerMetadata = new Map();

/**
 * Start the OCPP WebSocket server
 *
 * @param {http.Server} server - HTTP server instance
 */
export const startOcppServer = (server) => {
  // Setup event listeners for billing integration
  setupEventListeners();

  // Add proper WebSocket configuration for OCPP 1.6
  const wss = new WebSocketServer({
    server,
    verifyClient: verifyChargerConnection,
    handleProtocols: (protocols) => {
      if (protocols instanceof Set && protocols.has("ocpp1.6")) {
        return "ocpp1.6";
      }

      if (Array.isArray(protocols) && protocols.includes("ocpp1.6")) {
        return "ocpp1.6";
      }

      return false;
    },
  });

  // Update verifyChargerConnection function
  function verifyChargerConnection(info, callback) {
    const chargerId = extractChargerId(info.req.url);

    if (!chargerId) {
      console.warn("❌ Connection rejected: Missing charger ID in URL path");
      callback(
        false,
        400,
        "Missing charger ID. URL format: ws://server/chargerId",
      );
      return;
    }

    // Validate charger ID format (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(chargerId)) {
      console.warn(`❌ Invalid charger ID format: ${chargerId}`);
      callback(false, 400, "Invalid charger ID format");
      return;
    }

    // Check for OCPP 1.6 subprotocol
    // const protocols = info.req.headers["sec-websocket-protocol"];
    // const hasOcppProtocol = protocols && protocols.includes("ocpp1.6");
    const protocols = info.req.headers["sec-websocket-protocol"] || "";
    const hasOcppProtocol = protocols
      .split(",")
      .map((p) => p.trim())
      .includes("ocpp1.6");

    if (!hasOcppProtocol) {
      console.warn(`⚠️ Charger ${chargerId} missing OCPP 1.6 subprotocol`);
      // Some chargers don't send subprotocol correctly
      // Accept with warning for compatibility
    }

    // Add rate limiting check here if needed

    callback(true);
  }

  wss.on("connection", async (ws, req) => {
    // Extract charger ID from URL path
    const chargerId = extractChargerId(req.url);

    // Set up proper OCPP connection logging
    console.log(
      `🔌 [OCPP-CONNECT] Charger ${chargerId} connected from ${req.socket.remoteAddress}`,
    );
    console.log(
      `🔌 [OCPP-HEADERS] Sec-WebSocket-Protocol: ${req.headers["sec-websocket-protocol"]}`,
    );
    console.log(
      `🔌 [OCPP-HEADERS] User-Agent: ${req.headers["user-agent"] || "Unknown"}`,
    );

    // Store OCPP version for this connection
    chargerMetadata.set(chargerId, {
      connectedAt: new Date(),
      remoteAddress: req.socket.remoteAddress,
      lastMessageAt: null,
      ocppVersion: "1.6",
      userAgent: req.headers["user-agent"],
    });

    if (!chargerId || chargerId === "UNKNOWN") {
      console.warn("❌ Connection rejected: Invalid charger ID");
      ws.close(4001, "Invalid charger ID");
      return;
    }

    // Store connection
    chargers.set(chargerId, ws);
    chargerMetadata.set(chargerId, {
      connectedAt: new Date(),
      remoteAddress: req.socket.remoteAddress,
      lastMessageAt: null,
    });

    console.log(
      `🔌 Charger connected: ${chargerId} from ${req.socket.remoteAddress}`,
    );

    // Emit connection event
    ocppEvents.emitChargerConnected(chargerId, {
      remoteAddress: req.socket.remoteAddress,
    });

    // Recover any active sessions
    await handleChargerReconnection(chargerId);

    // Setup message handler
    ws.on("message", async (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        await routeOcppMessage(ws, chargerId, message);
      } catch (error) {
        console.error(
          `❌ Failed to parse OCPP message from ${chargerId}:`,
          error.message,
        );
      }
    });

    // Setup close handler
    ws.on("close", (code, reason) => {
      handleChargerDisconnection(chargerId, code, reason);
    });

    // Setup error handler
    ws.on("error", (error) => {
      console.error(`❌ WebSocket error for ${chargerId}:`, error.message);
    });

    // Setup ping/pong for connection health
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
  });

  // Heartbeat interval to detect dead connections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000); // 30 seconds

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  console.log("✅ OCPP WebSocket server started");
};

/**
 * Extract charger ID from URL path
 *
 * @param {string} url - Request URL (e.g., "/CP001" or "/ocpp/CP001")
 * @returns {string} Charger ID
 */
function extractChargerId(url) {
  if (!url) return null;

  // Remove query string
  const path = url.split("?")[0];

  // Extract last path segment as charger ID
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  // If path is /ocpp/CHARGER_ID, use last segment
  // If path is /CHARGER_ID, use that
  return segments[segments.length - 1] || null;
}

/**
 * Route incoming OCPP message to appropriate handler
 *
 * @param {WebSocket} ws
 * @param {string} chargerId
 * @param {array} message - Parsed OCPP message
 */
async function routeOcppMessage(ws, chargerId, message) {
  const metadata = chargerMetadata.get(chargerId);
  if (metadata) {
    metadata.lastMessageAt = new Date();
  }

  // Validate message structure
  const structureValidation = validateMessageStructure(message);
  if (!structureValidation.valid) {
    console.warn(
      `⚠️ Invalid OCPP message from ${chargerId}: ${structureValidation.error}`,
    );
    // Can't send error without messageId
    return;
  }

  const messageType = message[0];
  const messageId = message[1];

  // Log incoming message for audit trail (async, don't await)
  ocppLoggingService.logIncomingMessage(chargerId, message).catch((err) => {
    console.error("Failed to log OCPP message:", err.message);
  });

  try {
    switch (messageType) {
      case MessageType.CALL:
        // [2, messageId, action, payload]
        const action = message[2];
        const payload = message[3] || {};

        // Validate payload against schema
        const payloadValidation = validatePayload(action, payload);
        if (!payloadValidation.valid) {
          console.warn(
            `⚠️ Invalid payload for ${action} from ${chargerId}:`,
            payloadValidation.errors,
          );
          sendCallError(
            ws,
            messageId,
            payloadValidation.errorCode,
            payloadValidation.errors.join("; "),
          );
          return;
        }

        await handleOcppMessage(ws, chargerId, messageId, action, payload);
        break;

      case MessageType.CALLRESULT:
        // [3, messageId, payload]
        const resultPayload = message[2] || {};
        handleCallResult(messageId, resultPayload);
        break;

      case MessageType.CALLERROR:
        // [4, messageId, errorCode, errorDescription, errorDetails]
        const errorCode = message[2];
        const errorDescription = message[3] || "";
        const errorDetails = message[4] || {};
        handleCallError(messageId, errorCode, errorDescription, errorDetails);
        break;

      default:
        console.warn(
          `⚠️ Unknown message type ${messageType} from ${chargerId}`,
        );
        sendCallError(
          ws,
          messageId,
          ErrorCode.PROTOCOL_ERROR,
          "Unknown message type",
        );
    }
  } catch (error) {
    console.error(`❌ Error processing message from ${chargerId}:`, {
      error: error.message,
      stack: error.stack,
      messageType,
      action: message[2],
    });

    if (messageType === MessageType.CALL) {
      // Don't expose internal error details
      sendCallError(
        ws,
        messageId,
        ErrorCode.INTERNAL_ERROR,
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
      );
    }
  }
}

/**
 * Handle charger reconnection
 *
 * @param {string} chargerId
 */
async function handleChargerReconnection(chargerId) {
  try {
    // Check for active sessions that need to be recovered
    const session =
      await sessionService.recoverSessionAfterReconnect(chargerId);

    if (session) {
      console.log(
        `🔄 Active session found for ${chargerId}: ${session.transactionId}`,
      );
      // The charger will send StatusNotification and MeterValues
      // which will continue the session naturally
    }

    // Update charger connection state in database
    await prisma.charger.updateMany({
      where: { id: chargerId },
      data: {
        connectionState: "CONNECTED",
        lastSeen: new Date(),
      },
    });
  } catch (error) {
    console.error(
      `Error handling reconnection for ${chargerId}:`,
      error.message,
    );
  }
}

/**
 * Handle charger disconnection
 *
 * @param {string} chargerId
 * @param {number} code - Close code
 * @param {Buffer} reason - Close reason
 */
async function handleChargerDisconnection(chargerId, code, reason) {
  console.log(`❌ Charger disconnected: ${chargerId} (code: ${code})`);

  // Clean up
  chargers.delete(chargerId);
  chargerMetadata.delete(chargerId);

  // Cancel pending messages
  cancelPendingMessages(chargerId);

  // Emit disconnection event
  ocppEvents.emitChargerDisconnected(chargerId, {
    code,
    reason: reason?.toString(),
  });

  // Update database
  try {
    await prisma.charger.updateMany({
      where: { id: chargerId },
      data: {
        connectionState: "DISCONNECTED",
        lastSeen: new Date(),
      },
    });
  } catch (error) {
    console.error(`Error updating charger state on disconnect:`, error.message);
  }
}

/**
 * Get WebSocket connection for a charger
 *
 * @param {string} chargerId
 * @returns {WebSocket|null}
 */
export function getChargerConnection(chargerId) {
  return chargers.get(chargerId) || null;
}

/**
 * Check if a charger is online
 *
 * @param {string} chargerId
 * @returns {boolean}
 */
export function isChargerOnline(chargerId) {
  const ws = chargers.get(chargerId);
  return ws && ws.readyState === 1; // WebSocket.OPEN
}

/**
 * Get all connected charger IDs
 *
 * @returns {string[]}
 */
export function getConnectedChargerIds() {
  return Array.from(chargers.keys());
}

/**
 * Get charger connection metadata
 *
 * @param {string} chargerId
 * @returns {object|null}
 */
export function getChargerMetadata(chargerId) {
  return chargerMetadata.get(chargerId) || null;
}

export default {
  startOcppServer,
  chargers,
  getChargerConnection,
  isChargerOnline,
  getConnectedChargerIds,
  getChargerMetadata,
};
