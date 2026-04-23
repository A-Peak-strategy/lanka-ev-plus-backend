import { sendCallResult } from "../messageQueue.js";
import { Measurand } from "../ocppConstants.js";
import { getConnectorState, updateConnectorState } from "../../services/chargerStore.service.js";
import { ocppEvents } from "../ocppEvents.js";
import sessionService from "../../services/session.service.js";
import billingService from "../../services/billing.service.js";
import sessionLiveService from "../../services/sessionLive.service.js";
import prisma from "../../config/db.js";

/**
 * OCPP MeterValues Handler
 * 
 * Sent by the Charge Point during a charging session to report meter readings.
 * 
 * Now connector-aware: reads state from the correct connector and routes
 * billing/live updates to the right session.
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

  console.log(`[METER] ${chargerId}#${connectorId}: Received meter values (${meterValue.length} entries)`);

  // Validate payload
  if (!meterValue || meterValue.length === 0) {
    console.warn(`[METER] ${chargerId}#${connectorId}: Empty meterValue`);
    sendCallResult(ws, messageId, {});
    return;
  }

  // Get connector-specific state (not charger-level!)
  const connState = await getConnectorState(chargerId, connectorId);

  const sessionId = connState?.ocppTransactionId; // ChargingSession.id (OCPP)
  const txId = connState?.transactionId ?? connState?.ocppTransactionId ?? null;

  if (!sessionId || !txId) {
    console.warn(`[METER] ${chargerId}#${connectorId}: No active session (sessionId=${sessionId}, txId=${txId})`);
    sendCallResult(ws, messageId, {});
    return;
  }

  // Extract meter readings
  const readings = extractMeterReadings(meterValue);

  if (!readings.energy && readings.energy !== 0) {
    console.warn(`[METER] ${chargerId}#${connectorId}: No energy reading found`);
    sendCallResult(ws, messageId, {});
    return;
  }

  const energyWh = readings.energy;
  const meterTimestamp = new Date(meterValue[meterValue.length - 1].timestamp);

  // Get the session's meterStartWh from connector state or DB
  let sessionMeterStart = connState?.meterStartWh;

  if (sessionMeterStart == null) {
    // Fallback: read from ChargingSession table (set during StartTransaction)
    try {
      const dbSession = await prisma.chargingSession.findUnique({
        where: { id: sessionId },
        select: { meterStartWh: true },
      });
      sessionMeterStart = dbSession?.meterStartWh ?? energyWh;
      // Also update connector state so future calls don't need the DB lookup
      await updateConnectorState(chargerId, connectorId, { meterStartWh: sessionMeterStart });
    } catch (e) {
      console.warn(`[METER] ${chargerId}#${connectorId}: Could not fetch session meterStart, using current reading`);
      sessionMeterStart = energyWh;
    }
  }

  // Compute energy used in this session (for live display + event)
  const energyUsedWh = Math.max(0, energyWh - sessionMeterStart);
  console.log(`[METER] ${chargerId}#${connectorId}: meterStart=${sessionMeterStart}, current=${energyWh}, sessionEnergy=${energyUsedWh}Wh`);

  // Single consolidated state update for THIS connector
  await updateConnectorState(chargerId, connectorId, {
    lastMeterValueWh: energyWh,
    lastMeterTime: new Date(),
  });

  // Update live session snapshot (USED BY MOBILE APP) and session record
  try {
    await sessionLiveService.upsertLiveMeter({
      sessionId,
      transactionId: txId ?? null,
      chargerId,
      connectorId,
      readings,
      energyUsedWh,
      meterTimestamp,
    });

    await sessionService.updateSessionMeter(sessionId, energyWh);
    console.log(`[METER] ${chargerId}#${connectorId}: ${energyWh}Wh (session: ${energyUsedWh}Wh)`);
  } catch (error) {
    console.error(`[METER] Live session update failed:`, error.message);
  }

  // Process billing directly (NOT via event emitter to avoid double billing)
  try {
    const billingResult = await billingService.processMeterValuesBilling({
      chargerId,
      transactionId: txId,
      currentMeterWh: energyWh,
    });

    if (billingResult.success && !billingResult.skipped && !billingResult.duplicate) {
      console.log(
        `[METER] ${chargerId}#${connectorId}: ${energyWh}Wh (+${billingResult.incrementalWh}Wh), ` +
        `Billed: LKR ${billingResult.incrementalCost}, Balance: LKR ${billingResult.newBalance}`
      );
    } else if (billingResult.insufficientFunds) {
      console.log(
        `[METER] ${chargerId}#${connectorId}: ${energyWh}Wh - INSUFFICIENT FUNDS ` +
        `(grace: ${billingResult.graceActive ? 'active' : 'started'})`
      );
    }
  } catch (error) {
    console.error(`[METER] Billing error for ${chargerId}#${connectorId}:`, error.message);
  }

  // Emit event AFTER billing (for other listeners like logging, notifications)
  ocppEvents.emitMeterUpdate({
    chargerId,
    connectorId,
    transactionId: txId,
    meterWh: energyWh,
    energyUsedWh,
    readings,
  });

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
    const unit = sample.unit;
    const context = sample.context || "Sample.Periodic";

    // Skip non-energy values from Transaction.Begin/End (chargers send zeros for power/voltage/current)
    const isTransactionEdge = context === "Transaction.Begin" || context === "Transaction.End";

    if (isNaN(value)) continue;

    switch (measurand) {
      case Measurand.ENERGY_ACTIVE_IMPORT_REGISTER:
      case "Energy.Active.Import.Register":
        // CRITICAL: Some chargers report in kWh, our system expects Wh
        // Per OCPP 1.6 spec, default unit for Energy is Wh, but "unit" field can override
        if (unit === "kWh") {
          readings.energy = Math.round(value * 1000); // Convert kWh → Wh
        } else {
          readings.energy = value; // Default: Wh
        }
        break;

      case Measurand.POWER_ACTIVE_IMPORT:
      case "Power.Active.Import":
        if (isTransactionEdge) break; // skip zero values from begin/end
        if (unit === "kW") {
          readings.power = value * 1000;
        } else {
          readings.power = value;
        }
        break;

      case Measurand.CURRENT_IMPORT:
      case "Current.Import":
        if (isTransactionEdge) break;
        readings.current = value;
        break;

      case Measurand.VOLTAGE:
      case "Voltage":
        if (isTransactionEdge) break;
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
        // If no measurand specified and this is the first value, assume it's energy (Wh)
        if (!sample.measurand && readings.energy === null) {
          if (unit === "kWh") {
            readings.energy = Math.round(value * 1000);
          } else {
            readings.energy = value;
          }
        }
    }
  }

  return readings;
}
