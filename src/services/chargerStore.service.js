import {
  getChargerStateAPI,
  updateChargerStateAPI,
  updateMeterValueAPI,
  getAllChargerStatesAPI,
} from "./chargerRuntime.service.js";

const chargersStore = new Map();

// READ: cache -> DB fallback
export async function getChargerState(chargerId) {
  const cached = chargersStore.get(chargerId);
  if (cached) return cached;

  const dbState = await getChargerStateAPI(chargerId);

  if (dbState) {
    chargersStore.set(chargerId, dbState);
  }

  return dbState; // ✅ return DB if cache miss
}

// WRITE: DB first -> cache MERGE (preserve non-DB fields like pendingUserId)
export async function updateChargerState(chargerId, update) {
  const updated = await updateChargerStateAPI(chargerId, update);
  const existing = chargersStore.get(chargerId) || {};
  chargersStore.set(chargerId, { ...existing, ...updated });
  return { ...existing, ...updated };
}

// WRITE meter: DB first -> cache MERGE
export async function updateMeterValue(chargerId, meterWh) {
  const updated = await updateMeterValueAPI(chargerId, meterWh);
  const existing = chargersStore.get(chargerId) || {};
  chargersStore.set(chargerId, { ...existing, ...updated });
  return { ...existing, ...updated };
}

export async function getAllChargerStates() {
  const rows = await getAllChargerStatesAPI();
  // hydrate cache (optional)
  for (const st of rows) chargersStore.set(st.chargerId, st);
  return rows;
}

export { chargersStore };
export default chargersStore;
