import prisma from "../config/db.js";
import { getAllConnectorStates } from "./chargerStore.service.js";

export const syncChargerToDb = async (chargerId) => {
  // Get all connector states for this charger
  const connMap = await getAllConnectorStates(chargerId);
  if (!connMap || connMap.size === 0) return;

  // Use first connector state for charger-level fields
  const firstState = connMap.values().next().value;
  if (!firstState) return;

  const normalizedStatus =
    typeof firstState.status === "string"
      ? firstState.status.toUpperCase()
      : firstState.status;

  // In-memory store uses "connectionStatus", DB uses "connectionState"
  const rawConnection = firstState.connectionStatus || firstState.connectionState || "DISCONNECTED";
  const normalizedConnectionState =
    typeof rawConnection === "string"
      ? rawConnection.toUpperCase()
      : "DISCONNECTED";

  await prisma.charger.upsert({
    where: { id: chargerId },
    update: {
      status: normalizedStatus,
      connectionState: normalizedConnectionState,
      lastHeartbeat: firstState.lastHeartbeat,
      lastSeen: new Date(),
      totalEnergyWh: firstState.meterWh,
    },
    create: {
      id: chargerId,
      status: normalizedStatus,
      connectionState: normalizedConnectionState,
      lastHeartbeat: firstState.lastHeartbeat,
      lastSeen: new Date(),
      totalEnergyWh: firstState.meterWh,
    },
  });
};
