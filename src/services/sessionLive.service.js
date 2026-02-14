import prisma from "../config/db.js";


class SessionLiveService {

    async upsertLiveMeter({
        sessionId,
        transactionId,
        chargerId,
        connectorId,
        readings,
        energyWh,
        meterTimestamp
    }) {
        return prisma.chargingSessionLive.upsert({
            where: {
                transactionId,
            },
            update: {
                energyWh,
                powerW: readings.power ?? 0,
                voltageV: readings.voltage,
                currentA: readings.current,
                socPercent: readings.soc,
                temperatureC: readings.temperature,
                lastMeterAt: meterTimestamp,
            },
            create: {
                transactionId,
                chargerId,
                connectorId,
                energyWh,
                powerW: readings.power ?? 0,
                voltageV: readings.voltage,
                currentA: readings.current,
                socPercent: readings.soc,
                temperatureC: readings.temperature,
                lastMeterAt: meterTimestamp,

                // session: {
                //     connect: { transactionId },
                // },
                session: {
                    connectOrCreate: {
                        where: { transactionId },
                        create: {
                            transactionId,
                            chargerId,
                            connectorId: String(connectorId),
                            startedAt: new Date(),  
                        },
                    },
                },

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
