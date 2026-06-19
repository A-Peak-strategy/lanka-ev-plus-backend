import {
    getAppConfigService,
    updateAppConfigService,
} from "../services/appConfig.service.js";

export async function getAppConfig(req, res) {
    const config = await getAppConfigService();

    res.json(config);
}

export async function updateAppConfig(req, res) {
    const updated = await updateAppConfigService(req.body);

    res.json({
        success: true,
        data: updated,
    });
}