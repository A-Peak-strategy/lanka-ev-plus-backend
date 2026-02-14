const chargersStore = new Map();

// export const getChargerState = (id) => chargersStore.get(id);

/**
 * Get charger state
 */
export function getChargerState(chargerId) {
  return chargersStore.get(chargerId);
}

/**
 * Update charger state
 */
export function updateChargerState(chargerId, update) {
  const charger = chargersStore.get(chargerId) || {};
  chargersStore.set(chargerId, { ...charger, ...update });
}

/**
 * Update last meter reading
 */
export function updateMeterValue(chargerId, meterWh) {
  const charger = chargersStore.get(chargerId) || {};
  chargersStore.set(chargerId, { ...charger, lastMeterValue: meterWh });
}

export const getAllChargerStates = () =>
  Array.from(chargersStore.values());

// export const updateChargerState = (id, data) => {
//   chargersStore.set(id, {
//     ...(chargersStore.get(id) || {}),
//     chargerId: id,
//     ...data,
//     updatedAt: new Date(),
//   });
// };

export { chargersStore }; // <-- named export
export default chargersStore; // <-- default export