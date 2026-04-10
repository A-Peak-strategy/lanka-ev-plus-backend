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
    // (optional) if you have Charger.status as enum
    // "status",
    // "connectionState",
    // "lastSeen",
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

export async function updateChargerStateAPI(chargerId, update) {
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

    // default connectorId if missing
    if (runtime.connectorId == null) runtime.connectorId = 1;

    const runtimeData = pick(runtime, RUNTIME_ALLOWED);

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

        // upsert runtime state always
        const row = await tx.chargerRuntimeState.upsert({
            where: { chargerId },
            update: runtimeData,
            create: {
                chargerId,
                connectorId: runtimeData.connectorId ?? 1,
                status: runtimeData.status ?? "AVAILABLE",
                ...runtimeData,
            },
        });

        return row;
    });
}


export async function getChargerStateAPI(chargerId) {
    return prisma.chargerRuntimeState.findUnique({
        where: { chargerId },
    });
}

export async function updateMeterValueAPI(chargerId, meterWh) {
    return prisma.chargerRuntimeState.upsert({
        where: { chargerId },
        update: { lastMeterValueWh: meterWh },
        create: {
            chargerId,
            connectorId: 1,
            status: "AVAILABLE",
            lastMeterValueWh: meterWh,
        },
    });
}


export async function getAllChargerStatesAPI() {
    return prisma.chargerRuntimeState.findMany();
}
