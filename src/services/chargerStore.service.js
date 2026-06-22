import {
  getChargerStateAPI,
  updateChargerStateAPI,
  updateMeterValueAPI,
  getAllChargerStatesAPI,
} from "./chargerRuntime.service.js";

const chargersStore = new Map();

/**
 * Helper to generate consistent keys for the in-memory store
 */
export function getChargerKey(chargerId, connectorId = 1) {
  return `${chargerId}:${parseInt(connectorId)}`;
}

// READ: cache -> DB fallback
export async function getChargerState(chargerId, connectorId = 1) {
  const cId = parseInt(connectorId);
  const key = getChargerKey(chargerId, cId);
  const cached = chargersStore.get(key);
  if (cached) return cached;

  const dbState = await getChargerStateAPI(chargerId, cId);

  if (dbState) {
    chargersStore.set(key, dbState);
  }

  return dbState; // ✅ return DB if cache miss
}

// WRITE: DB first -> cache MERGE (preserve non-DB fields like pendingUserId)
export async function updateChargerState(chargerId, update) {
  const connectorId = parseInt(update.connectorId !== undefined ? update.connectorId : 1);
  const updated = await updateChargerStateAPI(chargerId, update);
  
  const key = getChargerKey(chargerId, connectorId);
  const existing = chargersStore.get(key) || {};
  chargersStore.set(key, { ...existing, ...updated });
  
  return { ...existing, ...updated };
}

// WRITE meter: DB first -> cache MERGE
export async function updateMeterValue(chargerId, meterWh, connectorId = 1) {
  const cId = parseInt(connectorId);
  const updated = await updateMeterValueAPI(chargerId, meterWh, cId);
  
  const key = getChargerKey(chargerId, cId);
  const existing = chargersStore.get(key) || {};
  chargersStore.set(key, { ...existing, ...updated });
  
  return { ...existing, ...updated };
}

export async function getAllChargerStates() {
  const rows = await getAllChargerStatesAPI();
  // hydrate cache
  for (const st of rows) {
    const key = getChargerKey(st.chargerId, st.connectorId);
    chargersStore.set(key, st);
  }
  return rows;
}

export { chargersStore };
export default chargersStore;
