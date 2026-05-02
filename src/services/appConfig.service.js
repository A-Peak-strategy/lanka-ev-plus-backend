import prisma from "../config/db.js";

export async function getAppConfigService() {
    return prisma.appConfig.findUnique({
        where: { id: 1 },
    });
}

export async function updateAppConfigService(data) {
    return prisma.appConfig.update({
        where: { id: 1 },
        data,
    });
}