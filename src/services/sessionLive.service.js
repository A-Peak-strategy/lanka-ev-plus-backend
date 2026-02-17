import prisma from "../config/db.js";


class SessionLiveService {

    async upsertLiveMeter({ sessionId, transactionId, chargerId, connectorId, readings, energyWh, meterTimestamp }) {
        return prisma.chargingSessionLive.upsert({
            where: { sessionId }, // ✅ sessionId is UNIQUE
            update: {
                transactionId: transactionId ?? null,
                energyWh,
                powerW: readings.power ?? null,
                voltageV: readings.voltage ?? null,
                currentA: readings.current ?? null,
                socPercent: readings.soc ?? null,
                temperatureC: readings.temperature ?? null,
                lastMeterAt: meterTimestamp,
            },
            create: {
                transactionId: transactionId ?? null,
                chargerId,
                connectorId,
                energyWh,
                powerW: readings.power ?? null,
                voltageV: readings.voltage ?? null,
                currentA: readings.current ?? null,
                socPercent: readings.soc ?? null,
                temperatureC: readings.temperature ?? null,
                lastMeterAt: meterTimestamp,
                session: { connect: { id: sessionId } }, // ✅ connect by ChargingSession.id
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
