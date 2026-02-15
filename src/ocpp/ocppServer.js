import { WebSocketServer } from "ws";
import { handleOcppMessage } from "./handlers/index.js";
import { cancelPendingMessages, handleCallResult, handleCallError } from "./messageQueue.js";
import { ocppEvents, setupEventListeners } from "./ocppEvents.js";
import { MessageType, ErrorCode } from "./ocppConstants.js";
import { sendCallError } from "./messageQueue.js";
import prisma from "../config/db.js";
import sessionService from "../services/session.service.js";
import ocppLoggingService from "../services/ocppLogging.service.js";
import { validateMessageStructure, validatePayload } from "./schemaValidator.js";

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

  const wss = new WebSocketServer({
    server,
    verifyClient: verifyChargerConnection,
    // OCPP 1.6-J requires subprotocol negotiation
    handleProtocols: (protocols, req) => {
      // Real chargers send "ocpp1.6" (or "ocpp1.6j") as subprotocol
      if (protocols.has("ocpp1.6")) return "ocpp1.6";
      if (protocols.has("ocpp1.6j")) return "ocpp1.6j";
      // Accept even if no subprotocol is specified (for testing tools)
      if (protocols.size === 0) return false;
      // If charger sends unknown protocols, still accept but log warning
      console.warn(`⚠️ Unknown OCPP subprotocols: ${[...protocols].join(", ")}`);
      return [...protocols][0]; // Accept the first offered protocol
    },
  });

  wss.on("connection", async (ws, req) => {
    // Extract charger ID from URL path
    const chargerId = extractChargerId(req.url);

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

    console.log(`🔌 Charger connected: ${chargerId} from ${req.socket.remoteAddress}`);

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
        console.error(`❌ Failed to parse OCPP message from ${chargerId}:`, error.message);
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
 * Verify incoming charger connection
 * 
 * @param {object} info - Connection info
 * @param {function} callback - Verification callback
 */
// function verifyChargerConnection(info, callback) {
//     const url = info.req.url;

//   // 🔥 ONLY allow /ocpp/*
//   if (!url.startsWith("/ocpp/")) {
//     callback(false, 404, "Not an OCPP endpoint");
//     return;
//   }

//   const chargerId = extractChargerId(url);
//   if (!chargerId) {
//     callback(false, 400, "Missing charger ID");
//     return;
//   }

//   // Subprotocol negotiation is handled by handleProtocols option
//   // Log the charger's offered protocols for debugging
//   const protocols = info.req.headers["sec-websocket-protocol"];
//   if (protocols) {
//     console.log(`🔌 Charger ${chargerId} offers protocols: ${protocols}`);
//   } else {
//     console.warn(`⚠️ Charger ${chargerId} did not offer any OCPP subprotocol`);
//   }

//   // Accept connection - charger identity is validated on BootNotification
//   callback(true);
// }
function verifyChargerConnection(info, callback) {
  const url = info.req.url;   

  // Allow only /ocpp/{chargerId}
  if (!url || !url.startsWith("/ocpp/")) {
    callback(false, 404, "Not an OCPP endpoint");
    return;
  }

  const chargerId = extractChargerId(url);
  if (!chargerId) {
    callback(false, 400, "Missing charger ID");
    return;
  }

  console.log(`🔌 Incoming WS handshake for charger: ${chargerId}`);

  callback(true);
}


/**
 * Extract charger ID from URL path
 * 
 * @param {string} url - Request URL (e.g., "/CP001" or "/ocpp/CP001")
 * @returns {string} Charger ID
 */
function extractChargerId(url) {
  const path = url.split("?")[0];
  const segments = path.split("/").filter(Boolean);

  // Expect: /ocpp/{CHARGER_ID}
  if (segments.length !== 2 || segments[0] !== "ocpp") {
    return null;
  }

  return segments[1];
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
    console.warn(`⚠️ Invalid OCPP message from ${chargerId}: ${structureValidation.error}`);
    // Can't send error without messageId
    return;
  }

  const messageType = message[0];
  const messageId = message[1];

  // Log incoming message for audit trail (async, don't await)
  ocppLoggingService.logIncomingMessage(chargerId, message).catch(err => {
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
          console.warn(`⚠️ Invalid payload for ${action} from ${chargerId}:`, payloadValidation.errors);
          sendCallError(
            ws,
            messageId,
            payloadValidation.errorCode,
            payloadValidation.errors.join("; ")
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
        console.warn(`⚠️ Unknown message type ${messageType} from ${chargerId}`);
        sendCallError(ws, messageId, ErrorCode.PROTOCOL_ERROR, "Unknown message type");
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
        process.env.NODE_ENV === "development" ? error.message : "Internal server error"
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
    const session = await sessionService.recoverSessionAfterReconnect(chargerId);

    if (session) {
      console.log(`🔄 Active session found for ${chargerId}: ${session.transactionId}`);
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
    console.error(`Error handling reconnection for ${chargerId}:`, error.message);
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
