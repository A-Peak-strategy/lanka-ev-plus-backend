import prisma from "../config/db.js";

export const findConnectorStatus = async (chargerId, connectorId) => {
    return await prisma.connector.findUnique({
        where: {
            chargerId_connectorId: {
                chargerId,
                connectorId
            }
        },
        select: {
            chargerId: true, 
            connectorId: true,
            status: true,
            errorCode: true,
            updatedAt: true
        }
    });
};
