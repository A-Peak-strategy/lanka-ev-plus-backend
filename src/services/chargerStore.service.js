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

// WRITE: DB first -> cache sync
export async function updateChargerState(chargerId, update) {
  const updated = await updateChargerStateAPI(chargerId, update);
  chargersStore.set(chargerId, updated);
  return updated;
}

// WRITE meter: DB first -> cache sync
export async function updateMeterValue(chargerId, meterWh) {
  const updated = await updateMeterValueAPI(chargerId, meterWh);
  chargersStore.set(chargerId, updated);
  return updated;
}

export async function getAllChargerStates() {
  const rows = await getAllChargerStatesAPI();
  // hydrate cache (optional)
  for (const st of rows) chargersStore.set(st.chargerId, st);
  return rows;
}

export { chargersStore };
export default chargersStore;
