import prisma from "../config/db.js";

const RUNTIME_ALLOWED = new Set([
    "connectorId",
    "status",
    "connectionStatus",
    "errorCode",
    "lastStatusUpdate",
    "bookingId",
    "transactionId",
    "internalTransactionId",
    "ocppTransactionId",
    "idTag",
    "userId",
    "meterStartWh",
    "lastMeterValueWh",
    "sessionStartTime",
]);

const CHARGER_ALLOWED = new Set([
    "vendor",
    "model",
    "serialNumber",
    "firmwareVersion",
    "iccid",
    "imsi",
    "meterType",
    "meterSerialNumber",
    "lastHeartbeat",
]);

function normStatus(s) {
    if (!s) return undefined;
    return String(s).toUpperCase();
}

function pick(obj, allowedSet) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (allowedSet.has(k) && v !== undefined) out[k] = v;
    }
    return out;
}

/**
 * Update runtime state for a specific connector on a charger.
 * Uses composite unique key (chargerId, connectorId).
 */
export async function updateConnectorStateAPI(chargerId, connectorId, update) {
    // ---- 1) normalize/mapping to runtime schema ----
    const runtime = {
        ...update,

        // map legacy fields → runtime fields
        internalTransactionId:
            update.internalTransactionId != null
                ? update.internalTransactionId
                : null,

        meterStartWh: update.meterStartWh ?? update.meterStart ?? null,
        lastMeterValueWh: update.lastMeterValueWh ?? update.lastMeterValue ?? null,

        // normalize enums
        status: update.status ? normStatus(update.status) : undefined,
        connectionStatus: update.connectionStatus
            ? normStatus(update.connectionStatus)
            : undefined,
    };

    const runtimeData = pick(runtime, RUNTIME_ALLOWED);
    // Remove connectorId from the data payload (it's part of the key)
    delete runtimeData.connectorId;

    // ---- 2) charger metadata update (optional but recommended) ----
    const chargerData = pick(update, CHARGER_ALLOWED);

    // run both in a transaction (safe)
    return prisma.$transaction(async (tx) => {
        // update charger metadata if provided
        if (Object.keys(chargerData).length > 0) {
            await tx.charger.update({
                where: { id: chargerId },
                data: chargerData,
            });
        }

        // upsert runtime state per connector
        const row = await tx.chargerRuntimeState.upsert({
            where: {
                chargerId_connectorId: { chargerId, connectorId },
            },
            update: runtimeData,
            create: {
                chargerId,
                connectorId,
                status: runtimeData.status ?? "AVAILABLE",
                ...runtimeData,
            },
        });

        return row;
    });
}

/**
 * Get runtime state for a specific connector.
 */
export async function getConnectorStateAPI(chargerId, connectorId) {
    return prisma.chargerRuntimeState.findUnique({
        where: {
            chargerId_connectorId: { chargerId, connectorId },
        },
    });
}

/**
 * Get all connector runtime states for a charger.
 */
export async function getAllConnectorStatesForChargerAPI(chargerId) {
    return prisma.chargerRuntimeState.findMany({
        where: { chargerId },
        orderBy: { connectorId: "asc" },
    });
}

/**
 * Update meter value for a specific connector.
 */
export async function updateConnectorMeterValueAPI(chargerId, connectorId, meterWh) {
    return prisma.chargerRuntimeState.upsert({
        where: {
            chargerId_connectorId: { chargerId, connectorId },
        },
        update: { lastMeterValueWh: meterWh },
        create: {
            chargerId,
            connectorId,
            status: "AVAILABLE",
            lastMeterValueWh: meterWh,
        },
    });
}

/**
 * Get all runtime states across all chargers.
 */
export async function getAllChargerStatesAPI() {
    return prisma.chargerRuntimeState.findMany({
        orderBy: [{ chargerId: "asc" }, { connectorId: "asc" }],
    });
}

// ---- Backward-compat wrappers (used by code not yet migrated) ----

/** @deprecated Use updateConnectorStateAPI */
export async function updateChargerStateAPI(chargerId, update) {
    const connId = update.connectorId ?? 1;
    return updateConnectorStateAPI(chargerId, connId, update);
}

/** @deprecated Use getConnectorStateAPI */
export async function getChargerStateAPI(chargerId) {
    return getConnectorStateAPI(chargerId, 1);
}

/** @deprecated Use updateConnectorMeterValueAPI */
export async function updateMeterValueAPI(chargerId, meterWh) {
    return updateConnectorMeterValueAPI(chargerId, 1, meterWh);
}
