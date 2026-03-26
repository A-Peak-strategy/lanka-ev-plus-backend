import prisma from "../config/db.js";


class SessionLiveService {

    async upsertLiveMeter({ sessionId, transactionId, chargerId, connectorId, readings, energyUsedWh, meterTimestamp }) {
        // Only include power/voltage/current in update if they have non-null values
        // This prevents Transaction.Begin/End readings (which skip these) from wiping stored values
        const liveUpdate = {
            transactionId: transactionId ?? null,
            energyWh: energyUsedWh,
            socPercent: readings.soc ?? undefined, // undefined = don't update in Prisma
            temperatureC: readings.temperature ?? undefined,
            lastMeterAt: meterTimestamp,
        };

        // Only overwrite power/voltage/current if we have actual readings
        if (readings.power != null) liveUpdate.powerW = readings.power;
        if (readings.voltage != null) liveUpdate.voltageV = readings.voltage;
        if (readings.current != null) liveUpdate.currentA = readings.current;
        if (readings.soc != null) liveUpdate.socPercent = readings.soc;

        return prisma.chargingSessionLive.upsert({
            where: { sessionId },
            update: liveUpdate,
            create: {
                transactionId: transactionId ?? null,
                chargerId,
                connectorId,
                energyWh: energyUsedWh,
                powerW: readings.power ?? null,
                voltageV: readings.voltage ?? null,
                currentA: readings.current ?? null,
                socPercent: readings.soc ?? null,
                temperatureC: readings.temperature ?? null,
                lastMeterAt: meterTimestamp,
                session: { connect: { id: sessionId } },
            },
        });
    }


    async getLiveByTransaction(transactionId) {
        return prisma.chargingSessionLive.findUnique({
            where: { transactionId }
        });
    }
}

export default new SessionLiveService();
