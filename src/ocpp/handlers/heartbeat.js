import { sendCallResult } from "../messageQueue.js";
import { updateChargerState } from "../../services/chargerStore.service.js";
import { ocppEvents } from "../ocppEvents.js";
import prisma from "../../config/db.js";

/**
 * OCPP Heartbeat Handler
 * 
 * The Charge Point sends Heartbeat to let the Central System know it's still alive.
 * The Central System responds with the current time.
 * 
 * Frequency: Configured in BootNotification response (interval field)
 * 
 * Request: {} (empty)
 * Response: { currentTime: ISO8601 timestamp }
 */
export default async function heartbeat(ws, messageId, chargerId, payload) {
  const currentTime = new Date();

  // Update charger state
  updateChargerState(chargerId, {
    lastHeartbeat: currentTime,
    connectionStatus: "Connected",
  });

  // Emit event
  ocppEvents.emitHeartbeat(chargerId);

  // Update database (async, non-blocking)
  updateChargerHeartbeat(chargerId, currentTime).catch((err) => {
    console.error(`Failed to update heartbeat in DB for ${chargerId}:`, err.message);
  });

  // Send response with current time
  sendCallResult(ws, messageId, {
    currentTime: currentTime.toISOString(),
  });
}

/**
 * Update charger heartbeat in database
 */
async function updateChargerHeartbeat(chargerId, timestamp) {
  await prisma.charger.updateMany({
    where: { id: chargerId },
    data: {
      lastHeartbeat: timestamp,
      lastSeen: timestamp,
      connectionState: "CONNECTED",
    },
  });
}

