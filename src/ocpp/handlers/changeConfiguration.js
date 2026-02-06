import { sendCallResult } from "../messageQueue.js";
import { ConfigurationStatus } from "../ocppConstants.js";

/**
 * OCPP 1.6 ChangeConfiguration
 * Central System requests Charge Point to change a configuration setting
 */
export default async function changeConfiguration(
    ws,
    messageId,
    chargerId,
    payload,
) {
    const { key, value } = payload;

    console.log(
        `[CFG] ${chargerId}: ChangeConfiguration key=${key}, value=${value}`,
    );

    // List of configurable parameters
    const configurableKeys = [
        "HeartbeatInterval",
        "ConnectionTimeOut",
        "MeterValueSampleInterval",
        "ClockAlignedDataInterval",
        "MeterValuesSampledData",
        "MeterValuesAlignedData",
        "StopTxnSampledData",
        "StopTxnAlignedData",
        "SupportedFeatureProfiles",
        "NumberOfConnectors",
        "ChargeProfileMaxStackLevel",
        "ChargingScheduleAllowedChargingRateUnit",
        "ChargingScheduleMaxPeriods",
        "ConnectorSwitch3to1PhaseSupported",
        "MaxEnergyOnInvalidId",
    ];

    if (!key || !configurableKeys.includes(key)) {
        return sendCallResult(ws, messageId, {
            status: ConfigurationStatus.NOT_SUPPORTED,
        });
    }

    try {
        // In production, store in database or charger configuration store
        console.log(`[CFG] ${chargerId}: Would update ${key}=${value}`);

        sendCallResult(ws, messageId, {
            status: ConfigurationStatus.ACCEPTED,
        });
    } catch (error) {
        console.error(`[CFG] Error changing configuration:`, error);
        sendCallResult(ws, messageId, {
            status: ConfigurationStatus.REJECTED,
        });
    }
}
