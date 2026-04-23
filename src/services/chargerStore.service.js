import {
  getConnectorStateAPI,
  updateConnectorStateAPI,
  updateConnectorMeterValueAPI,
  getAllChargerStatesAPI,
  getAllConnectorStatesForChargerAPI,
  // backward-compat re-exports
  getChargerStateAPI,
  updateChargerStateAPI,
  updateMeterValueAPI,
} from "./chargerRuntime.service.js";

/**
 * In-memory charger/connector state store.
 *
 * Structure: Map<chargerId, Map<connectorId, stateObject>>
 *
 * This gives O(1) lookup for any connector's live state
 * and allows multiple connectors per charger to have
 * fully independent state (transaction, meter, status, etc.)
 */
const chargersStore = new Map();

// ================================================================
//  PER-CONNECTOR API (primary — use these in new code)
// ================================================================

/**
 * Get state for a specific connector.
 * cache → DB fallback
 */
export async function getConnectorState(chargerId, connectorId) {
  const connMap = chargersStore.get(chargerId);
  const cached = connMap?.get(connectorId);
  if (cached) return cached;

  const dbState = await getConnectorStateAPI(chargerId, connectorId);
  if (dbState) {
    _setConnectorCache(chargerId, connectorId, dbState);
  }
  return dbState;
}

/**
 * Update state for a specific connector.
 * DB first → cache MERGE (preserves non-DB fields like pendingUserId)
 */
export async function updateConnectorState(chargerId, connectorId, update) {
  const updated = await updateConnectorStateAPI(chargerId, connectorId, update);
  const existing = _getConnectorCache(chargerId, connectorId) || {};
  const merged = { ...existing, ...updated };
  _setConnectorCache(chargerId, connectorId, merged);
  return merged;
}

/**
 * Update meter value for a specific connector.
 */
export async function updateConnectorMeterValue(chargerId, connectorId, meterWh) {
  const updated = await updateConnectorMeterValueAPI(chargerId, connectorId, meterWh);
  const existing = _getConnectorCache(chargerId, connectorId) || {};
  const merged = { ...existing, ...updated };
  _setConnectorCache(chargerId, connectorId, merged);
  return merged;
}

/**
 * Get all connector states for a charger.
 * Returns a Map<connectorId, state> (from cache if available, else DB).
 */
export async function getAllConnectorStates(chargerId) {
  // Try cache first
  const connMap = chargersStore.get(chargerId);
  if (connMap && connMap.size > 0) {
    return connMap;
  }

  // Fetch from DB
  const rows = await getAllConnectorStatesForChargerAPI(chargerId);
  const map = new Map();
  for (const row of rows) {
    map.set(row.connectorId, row);
  }
  chargersStore.set(chargerId, map);
  return map;
}

/**
 * Get the raw connector Map (or empty Map) for a charger from cache.
 * Does NOT hit DB — use for non-critical reads like pendingUserId.
 */
export function getConnectorCacheRaw(chargerId, connectorId) {
  return _getConnectorCache(chargerId, connectorId);
}

/**
 * Set a cache-only field on a connector (e.g. pendingUserId).
 * Does NOT write to DB.
 */
export function setConnectorCacheField(chargerId, connectorId, field, value) {
  const existing = _getConnectorCache(chargerId, connectorId) || {};
  existing[field] = value;
  _setConnectorCache(chargerId, connectorId, existing);
}

// ================================================================
//  BACKWARD-COMPAT API (for code not yet migrated)
//  These operate on connector 1 by default.
// ================================================================

/** @deprecated Use getConnectorState(chargerId, connectorId) */
export async function getChargerState(chargerId) {
  return getConnectorState(chargerId, 1);
}

/** @deprecated Use updateConnectorState(chargerId, connectorId, update) */
export async function updateChargerState(chargerId, update) {
  const connId = update.connectorId ?? 1;
  return updateConnectorState(chargerId, connId, update);
}

/** @deprecated Use updateConnectorMeterValue */
export async function updateMeterValue(chargerId, meterWh) {
  return updateConnectorMeterValue(chargerId, 1, meterWh);
}

export async function getAllChargerStates() {
  const rows = await getAllChargerStatesAPI();
  // hydrate cache
  for (const st of rows) {
    _setConnectorCache(st.chargerId, st.connectorId, st);
  }
  return rows;
}

// ================================================================
//  INTERNAL HELPERS
// ================================================================

function _getConnectorCache(chargerId, connectorId) {
  const connMap = chargersStore.get(chargerId);
  return connMap?.get(connectorId) ?? null;
}

function _setConnectorCache(chargerId, connectorId, state) {
  if (!chargersStore.has(chargerId)) {
    chargersStore.set(chargerId, new Map());
  }
  chargersStore.get(chargerId).set(connectorId, state);
}

export { chargersStore };
export default chargersStore;
