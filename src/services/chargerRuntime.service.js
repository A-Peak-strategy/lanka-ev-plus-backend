import prisma from "../config/db.js";

export async function getChargerStateAPI(chargerId) {
    return prisma.chargerRuntimeState.findUnique({ where: { chargerId } });
}

export async function updateChargerStateAPI(chargerId, update) {
    // upsert so it works even if first time
    const connectorId = update.connectorId ?? 1;

    return prisma.chargerRuntimeState.upsert({
        where: { chargerId },
        update: { ...update },
        create: {
            chargerId,
            connectorId,
            status: update.status ?? "AVAILABLE",
            internalTransactionId: update.internalTransactionId ?? null,
            ocppTransactionId: update.ocppTransactionId ?? null,
            idTag: update.idTag ?? null,
            userId: update.userId ?? null,
            meterStartWh: update.meterStartWh ?? null,
            lastMeterValueWh: update.lastMeterValueWh ?? null,
            sessionStartTime: update.sessionStartTime ?? null,
        },
    });
}

export async function updateMeterValueAPI(chargerId, meterWh) {
    return prisma.chargerRuntimeState.update({
        where: { chargerId },
        data: { lastMeterValueWh: meterWh },
    });
}

export async function getAllChargerStatesAPI() {
    return prisma.chargerRuntimeState.findMany();
}
