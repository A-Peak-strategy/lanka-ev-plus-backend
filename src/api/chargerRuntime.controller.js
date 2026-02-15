import { getAllChargerStatesAPI, getChargerStateAPI, updateChargerStateAPI } from "../services/chargerRuntime.service.js";

export const getChargerRuntimeState = async (req, res, next) => {
    try {
        const { chargerId } = req.params;
        const state = await getChargerStateAPI(chargerId);

        res.json({ success: true, data: state });
    } catch (e) {
        next(e);
    }
};

export const getActiveChargingInfo = async (req, res, next) => {
    try {
        const { chargerId } = req.params;
        const st = await getChargerStateAPI(chargerId);

        const active = !!st?.ocppTransactionId;

        res.json({
            success: true,
            active,
            status: st?.status ?? null,
            connectorId: st?.connectorId ?? null,
            transactionId: st?.ocppTransactionId ?? null, // ✅ int
        });
    } catch (e) {
        next(e);
    }
};

export const getAllChargerRuntimeStates = async (req, res, next) => {
    try {
        const states = await getAllChargerStatesAPI();  
        res.json({ success: true, count: states.length, data: states });
    } catch (e) {
        next(e);
    }
};

export const updateChargerRuntimeState = async (req, res, next) => {
    try {
        const { chargerId } = req.params;
        const updateData = req.body;    
        const updatedState = await updateChargerStateAPI(chargerId, updateData);
        res.json({ success: true, data: updatedState });
    } catch (e) {
        next(e);
    }
};