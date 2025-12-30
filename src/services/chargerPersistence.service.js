import prisma from "../config/db.js";
import chargerStore from "./chargerStore.service.js";

export const syncChargerToDb = async (chargerId) => {
  const state = chargerStore.get(chargerId);
  if (!state) return;

  await prisma.charger.upsert({
    where: { id: chargerId },
    update: {
      status: state.status,
      connectionState: state.connectionStatus,
      lastHeartbeat: state.lastHeartbeat,
      lastSeen: new Date(),
      totalEnergyWh: state.meterWh,
    },
    create: {
      id: chargerId,
      status: state.status,
      connectionState: state.connectionStatus,
      lastHeartbeat: state.lastHeartbeat,
      lastSeen: new Date(),
      totalEnergyWh: state.meterWh,
    },
  });
};
