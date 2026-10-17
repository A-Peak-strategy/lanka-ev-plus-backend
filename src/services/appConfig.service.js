import prisma from "../config/db.js";

function defaultAppConfig() {
    return {
        latestAndroidVersion: process.env.APP_CONFIG_DEFAULT_LATEST_ANDROID_VERSION || "0.0.0",
        latestIosVersion: process.env.APP_CONFIG_DEFAULT_LATEST_IOS_VERSION || "0.0.0",
        minAndroidVersion: process.env.APP_CONFIG_DEFAULT_MIN_ANDROID_VERSION || "0.0.0",
        minIosVersion: process.env.APP_CONFIG_DEFAULT_MIN_IOS_VERSION || "0.0.0",
        forceUpdate: false,
        maintenanceMode: false,
        maintenanceMessage: null,
    };
}

async function ensureAppConfig() {
    const existing = await prisma.appConfig.findUnique({ where: { id: 1 } });
    if (existing) return existing;

    try {
        return await prisma.appConfig.create({ data: { id: 1, ...defaultAppConfig() } });
    } catch (error) {
        // Two first requests can race only on a brand-new database. Read the
        // row created by the other request rather than failing the app launch.
        if (error.code === "P2002") {
            return prisma.appConfig.findUnique({ where: { id: 1 } });
        }
        throw error;
    }
}

export async function getAppConfigService() {
    return ensureAppConfig();
}

export async function updateAppConfigService(data) {
    await ensureAppConfig();
    return prisma.appConfig.update({
        where: { id: 1 },
        data,
    });
}
