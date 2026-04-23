import {
    getAllChargerStatesAPI,
    getConnectorStateAPI,
    getAllConnectorStatesForChargerAPI,
    updateConnectorStateAPI,
} from "../services/chargerRuntime.service.js";

/**
 * Get runtime state for a charger (all connectors)
 */
export const getChargerRuntimeState = async (req, res, next) => {
    try {
        const { chargerId } = req.params;
        const states = await getAllConnectorStatesForChargerAPI(chargerId);

        res.json({ success: true, data: states });
    } catch (e) {
        next(e);
    }
};

/**
 * Get active charging info for a charger (all connectors)
 */
export const getActiveChargingInfo = async (req, res, next) => {
    try {
        const { chargerId } = req.params;
        const states = await getAllConnectorStatesForChargerAPI(chargerId);

        // Build per-connector charging info
        const connectors = states.map(st => ({
            connectorId: st.connectorId,
            active: !!st.ocppTransactionId,
            status: st.status ?? null,
            transactionId: st.ocppTransactionId ?? null,
            userId: st.userId ?? null,
        }));

        const anyActive = connectors.some(c => c.active);

        res.json({
            success: true,
            active: anyActive,
            connectors,
        });
    } catch (e) {
        next(e);
    }
};

/**
 * Get all charger runtime states (all chargers, all connectors)
 */
export const getAllChargerRuntimeStates = async (req, res, next) => {
    try {
        const states = await getAllChargerStatesAPI();
        res.json({ success: true, count: states.length, data: states });
    } catch (e) {
        next(e);
    }
};

/**
 * Update runtime state for a specific connector
 */
export const updateChargerRuntimeState = async (req, res, next) => {
    try {
        const { chargerId } = req.params;
        const updateData = req.body;
        const connectorId = updateData.connectorId ?? 1;

        const updatedState = await updateConnectorStateAPI(chargerId, connectorId, updateData);
        res.json({ success: true, data: updatedState });
    } catch (e) {
        next(e);
    }
};