import { sendCallResult } from "../messageQueue.js";
import { Measurand } from "../ocppConstants.js";
import { getChargerState, updateChargerState } from "../../services/chargerStore.service.js";
import { ocppEvents } from "../ocppEvents.js";
import sessionService from "../../services/session.service.js";
import billingService from "../../services/billing.service.js";

/**
 * OCPP MeterValues Handler
 * 
 * Sent by the Charge Point during a charging session to report meter readings.
 * 
 * Request: {
 *   connectorId: number,
 *   transactionId?: number,
 *   meterValue: [{
 *     timestamp: ISO8601,
 *     sampledValue: [{
 *       value: string,
 *       context?: string,
 *       format?: string,
 *       measurand?: string,
 *       phase?: string,
 *       location?: string,
 *       unit?: string
 *     }]
 *   }]
 * }
 * 
 * Response: {} (empty)
 */
export default async function meterValues(ws, messageId, chargerId, payload) {
  const { connectorId, transactionId, meterValue } = payload;

  // Validate payload
  if (!meterValue || meterValue.length === 0) {
    console.warn(`[METER] ${chargerId}: Empty meterValue`);
    sendCallResult(ws, messageId, {});
    return;
  }

  // Get charger state
  const chargerState = getChargerState(chargerId);
  const activeTransactionId = chargerState?.transactionId || transactionId?.toString();

  if (!activeTransactionId) {
    console.warn(`[METER] ${chargerId}: No active transaction`);
    sendCallResult(ws, messageId, {});
    return;
  }

  // Extract meter readings
  const readings = extractMeterReadings(meterValue);

  if (!readings.energy && readings.energy !== 0) {
    console.warn(`[METER] ${chargerId}: No energy reading found`);
    sendCallResult(ws, messageId, {});
    return;
  }

  const energyWh = readings.energy;

  // Update meterStart if this is the first reading
  if (chargerState && !chargerState.meterStart) {
    chargerState.meterStart = energyWh;
    updateChargerState(chargerId, { meterStart: energyWh });
  }

  // Update last meter value
  updateChargerState(chargerId, {
    lastMeterValue: energyWh,
    lastMeterTime: new Date(),
  });

  // Calculate energy used in this session
  const energyUsed = chargerState?.meterStart 
    ? energyWh - chargerState.meterStart 
    : 0;

  // Emit event for billing (handled by event listener)
  ocppEvents.emitMeterUpdate({
    chargerId,
    connectorId,
    transactionId: activeTransactionId,
    meterWh: energyWh,
    energyUsedWh: energyUsed,
    readings,
  });

  // Process billing directly (in addition to event)
  try {
    const billingResult = await billingService.processMeterValuesBilling({
      chargerId,
      transactionId: activeTransactionId,
      currentMeterWh: energyWh,
    });

    if (billingResult.success && !billingResult.skipped && !billingResult.duplicate) {
      console.log(
        `[METER] ${chargerId}: ${energyWh}Wh (+${billingResult.incrementalWh}Wh), ` +
        `Billed: LKR ${billingResult.incrementalCost}, Balance: LKR ${billingResult.newBalance}`
      );
    } else if (billingResult.insufficientFunds) {
      console.log(
        `[METER] ${chargerId}: ${energyWh}Wh - INSUFFICIENT FUNDS ` +
        `(grace: ${billingResult.graceActive ? 'active' : 'started'})`
      );
    }
  } catch (error) {
    console.error(`[METER] Billing error for ${chargerId}:`, error.message);
  }

  // Update session in database
  try {
    await sessionService.updateSessionMeter(activeTransactionId, energyWh);
  } catch (error) {
    console.error(`[METER] Session update error:`, error.message);
  }

  // Send empty response
  sendCallResult(ws, messageId, {});
}

/**
 * Extract relevant meter readings from meterValue array
 * 
 * @param {array} meterValue
 * @returns {object} Extracted readings
 */
function extractMeterReadings(meterValue) {
  const readings = {
    energy: null,
    power: null,
    current: null,
    voltage: null,
    soc: null,
    temperature: null,
  };

  // Get the most recent meter value entry
  const lastEntry = meterValue[meterValue.length - 1];
  
  if (!lastEntry || !lastEntry.sampledValue) {
    return readings;
  }

  for (const sample of lastEntry.sampledValue) {
    const measurand = sample.measurand || Measurand.ENERGY_ACTIVE_IMPORT_REGISTER;
    const value = parseFloat(sample.value);

    if (isNaN(value)) continue;

    switch (measurand) {
      case Measurand.ENERGY_ACTIVE_IMPORT_REGISTER:
      case "Energy.Active.Import.Register":
        readings.energy = value;
        break;

      case Measurand.POWER_ACTIVE_IMPORT:
      case "Power.Active.Import":
        readings.power = value;
        break;

      case Measurand.CURRENT_IMPORT:
      case "Current.Import":
        readings.current = value;
        break;

      case Measurand.VOLTAGE:
      case "Voltage":
        readings.voltage = value;
        break;

      case Measurand.SOC:
      case "SoC":
        readings.soc = value;
        break;

      case Measurand.TEMPERATURE:
      case "Temperature":
        readings.temperature = value;
        break;

      default:
        // If no measurand specified and this is the first value, assume it's energy
        if (!sample.measurand && readings.energy === null) {
          readings.energy = value;
        }
    }
  }

  return readings;
}
