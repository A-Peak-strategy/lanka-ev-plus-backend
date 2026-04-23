import { sendCallResult } from "../messageQueue.js";
import { getAllConnectorStates, updateConnectorState } from "../../services/chargerStore.service.js";
import { ocppEvents } from "../ocppEvents.js";
import prisma from "../../config/db.js";

/**
 * OCPP Heartbeat Handler
 * 
 * The Charge Point sends Heartbeat to let the Central System know it's still alive.
 * The Central System responds with the current time.
 * 
 * Heartbeat is charger-level (not connector-level).
 * We update the lastHeartbeat on the Charger model and mark
 * all connectors' connectionStatus as Connected.
 * 
 * Frequency: Configured in BootNotification response (interval field)
 * 
 * Request: {} (empty)
 * Response: { currentTime: ISO8601 timestamp }
 */
export default async function heartbeat(ws, messageId, chargerId, payload) {
  const currentTime = new Date();

  // Update connectionStatus on all known connectors for this charger
  try {
    const connMap = await getAllConnectorStates(chargerId);
    if (connMap && connMap.size > 0) {
      for (const [connId] of connMap) {
        await updateConnectorState(chargerId, connId, {
          lastHeartbeat: currentTime,
          connectionStatus: "Connected",
        });
      }
    } else {
      // Fallback: at least update connector 1
      await updateConnectorState(chargerId, 1, {
        lastHeartbeat: currentTime,
        connectionStatus: "Connected",
      });
    }
  } catch (err) {
    console.error(`[HEARTBEAT] Failed to update connector states for ${chargerId}:`, err.message);
  }

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
