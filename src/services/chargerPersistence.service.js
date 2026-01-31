import prisma from "../config/db.js";
import chargerStore from "./chargerStore.service.js";

export const syncChargerToDb = async (chargerId) => {
  const state = chargerStore.get(chargerId);
  if (!state) return;

  const normalizedStatus =
    typeof state.status === "string"
      ? state.status.toUpperCase()
      : state.status;

  const normalizedConnectionState =
    typeof state.connectionStatus === "string"
      ? state.connectionStatus.toUpperCase()
      : state.connectionStatus;

  await prisma.charger.upsert({
    where: { id: chargerId },
    update: {
      status: normalizedStatus,
      connectionState: normalizedConnectionState,
      lastHeartbeat: state.lastHeartbeat,
      lastSeen: new Date(),
      totalEnergyWh: state.meterWh,
    },
    create: {
      id: chargerId,
      status: normalizedStatus,
      connectionState: normalizedConnectionState,
      lastHeartbeat: state.lastHeartbeat,
      lastSeen: new Date(),
      totalEnergyWh: state.meterWh,
    },
  });
};
