import { sendCallResult } from "../messageQueue.js";

/**
 * OCPP 1.6 GetConfiguration
 * Central System requests current configuration from Charge Point
 */
export default async function getConfiguration(
    ws,
    messageId,
    chargerId,
    payload,
) {
    const { key } = payload;

    console.log(`[CFG] ${chargerId}: GetConfiguration key=${key ? key : "ALL"}`);

    // Default configuration values for OCPP 1.6
    const defaultConfiguration = {
        HeartbeatInterval: 300, // 5 minutes in seconds
        ConnectionTimeOut: 30, // 30 seconds
        MeterValueSampleInterval: 60, // 60 seconds
        ClockAlignedDataInterval: 900, // 15 minutes in seconds
        MeterValuesSampledData:
            "Energy.Active.Import.Register,Current.Import,Voltage,Power.Active.Import",
        MeterValuesAlignedData: "Energy.Active.Import.Register",
        StopTxnSampledData:
            "Energy.Active.Import.Register,Current.Import,Voltage,Power.Active.Import",
        StopTxnAlignedData: "Energy.Active.Import.Register",
        SupportedFeatureProfiles:
            "Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger",
        NumberOfConnectors: 1,
        ChargeProfileMaxStackLevel: 1,
        ChargingScheduleAllowedChargingRateUnit: "Current,Power",
        ChargingScheduleMaxPeriods: 1,
        ConnectorSwitch3to1PhaseSupported: false,
        MaxEnergyOnInvalidId: 0,
    };

    const configurationKey = key || Object.keys(defaultConfiguration);
    const unknownKeys = Array.isArray(configurationKey)
        ? []
        : !defaultConfiguration[configurationKey]
            ? [configurationKey]
            : [];

    const configurationValue = Array.isArray(configurationKey)
        ? configurationKey.map((k) => ({
            key: k,
            value: defaultConfiguration[k] || "",
            readonly: false,
        }))
        : [
            {
                key: configurationKey,
                value: defaultConfiguration[configurationKey] || "",
                readonly: false,
            },
        ];

    sendCallResult(ws, messageId, {
        configurationKey: configurationValue,
        unknownKey: unknownKeys,
    });
}
