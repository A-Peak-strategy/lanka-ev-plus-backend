import { sendCallResult } from "../messageQueue.js";
import { AuthorizationStatus } from "../ocppConstants.js";
import { getChargerState, updateChargerState } from "../../services/chargerStore.service.js";
import { ocppEvents } from "../ocppEvents.js";
import sessionService from "../../services/session.service.js";
import billingService from "../../services/billing.service.js";
import notificationService from "../../services/notification.service.js";
import connectorLockService from "../../services/connectorLock.service.js";
import prisma from "../../config/db.js";

/**
 * OCPP StopTransaction Handler
 * 
 * Sent by the Charge Point when a charging session ends.
 * 
 * IMPORTANT: transactionId from charger is the integer we sent in StartTransaction.conf
 * (which is session.id). We resolve it to the internal string transactionId for billing.
 * 
 * Request: {
 *   idTag?: CiString20Type,
 *   meterStop: integer Wh (Required),
 *   timestamp: ISO8601 (Required),
 *   transactionId: integer (Required),
 *   reason?: StopReason,
 *   transactionData?: MeterValue[]
 * }
 * 
 * Response: {
 *   idTagInfo?: { status: AuthorizationStatus }
 * }
 */
export default async function stopTransaction(ws, messageId, chargerId, payload) {
  const {
    idTag,
    meterStop,
    timestamp,
    transactionId, // Integer from charger (= session.id)
    reason,
    transactionData,
  } = payload;

  const stopTime = timestamp ? new Date(timestamp) : new Date();

  console.log(`[STOP] ${chargerId}: ocppTxId=${transactionId}, meter=${meterStop}Wh, reason=${reason || 'Normal'}`);

  // Resolve OCPP integer transactionId to internal string transactionId and connector
  const session = await prisma.chargingSession.findUnique({
    where: { id: parseInt(transactionId) },
    include: { connector: true }
  });

  if (!session) {
    console.warn(`[STOP] No session found in DB for ocppTxId ${transactionId}`);
    // Fallback: try charger state (limited accuracy for dual-connector)
    const chargerState = await getChargerState(chargerId);
    if (chargerState?.ocppTransactionId === parseInt(transactionId)) {
       const activeTransactionId = chargerState.transactionId;
       const connectorId = chargerState.connectorId || 1;
       return processStop(ws, messageId, chargerId, activeTransactionId, connectorId, payload);
    }
    
    sendCallResult(ws, messageId, {});
    return;
  }

  const activeTransactionId = session.transactionId;
  const connectorId = session.connector?.connectorId || 1;

  await processStop(ws, messageId, chargerId, activeTransactionId, connectorId, payload);
}

/**
 * Shared logic for processing the stop transaction
 */
async function processStop(ws, messageId, chargerId, activeTransactionId, connectorId, payload) {
  const { idTag, meterStop, timestamp, reason, transactionData } = payload;
  const stopTime = timestamp ? new Date(timestamp) : new Date();

  try {
    // Process any remaining meter values from transactionData
    if (transactionData && transactionData.length > 0) {
      await processTransactionData(chargerId, activeTransactionId, transactionData);
    }

    // Process final billing for any unbilled energy
    try {
      await billingService.processMeterValuesBilling({
        chargerId,
        transactionId: activeTransactionId,
        currentMeterWh: meterStop,
      });
    } catch (billingError) {
      // Log but continue - don't fail stop transaction for billing errors
      console.error(`[STOP] Final billing error (continuing):`, billingError.message);
    }

    // Finalize session in database
    const { alreadyFinalized, notFound } = await sessionService.finalizeSession({
      transactionId: activeTransactionId,
      meterStop,
      timestamp: stopTime,
      reason,
      idTag,
    });

    if (notFound) {
      console.warn(`[STOP] Session ${activeTransactionId} not found in database`);
    } else if (alreadyFinalized) {
      console.log(`[STOP] Session ${activeTransactionId} was already finalized`);
    }

    // Finalize billing (clears grace period, calculates final cost)
    try {
      await billingService.finalizeSessionBilling(activeTransactionId);
    } catch (finalizeBillingError) {
      console.error(`[STOP] Finalize billing error:`, finalizeBillingError.message);
    }

    // Get final session data for notification
    const finalSession = await sessionService.getSessionByTransactionId(activeTransactionId);

    // Calculate session duration
    const duration = finalSession
      ? stopTime.getTime() - finalSession.startedAt.getTime()
      : 0;

    // Send completion notification (don't await - fire and forget)
    if (finalSession?.userId) {
      notificationService.sendChargingComplete({
        userId: finalSession.userId,
        transactionId: activeTransactionId,
        energyUsedWh: finalSession.energyUsedWh || 0,
        totalCost: finalSession.totalCost?.toString() || "0.00",
        duration,
      }).catch(err => console.error(`[STOP] Notification error:`, err.message));
    }

    // Emit event
    ocppEvents.emitSessionStopped({
      chargerId,
      connectorId,
      transactionId: activeTransactionId,
      meterStop,
      reason,
      stopTime,
      energyUsed: finalSession?.energyUsedWh || 0,
      totalCost: finalSession?.totalCost?.toString() || "0.00",
    });

    // Release connector lock
    await connectorLockService.markChargingComplete(
      chargerId,
      connectorId,
      activeTransactionId
    ).catch(err => console.error(`[STOP] Lock release error:`, err.message));

    // Reset charger state for the specific connector
    updateChargerState(chargerId, {
      connectorId,
      status: "Available",
      transactionId: null,
      ocppTransactionId: null,
      meterStart: null,
      lastMeterValue: null,
      idTag: null,
      userId: null,
      sessionStartTime: null,
      bookingId: null,
    });

    console.log(`✅ [STOP] Transaction ${activeTransactionId} completed: ` +
      `${((finalSession?.energyUsedWh || 0) / 1000).toFixed(2)} kWh, ` +
      `LKR ${finalSession?.totalCost?.toString() || '0.00'}`
    );

  } catch (error) {
    // Log full error details for debugging
    console.error(`[STOP] Error processing stop transaction:`, {
      transactionId: activeTransactionId,
      error: error.message,
      stack: error.stack,
    });
    
    // Still try to reset charger state to prevent stuck state
    updateChargerState(chargerId, {
      connectorId,
      status: "Available",
      transactionId: null,
    });
  }

  // Send response
  // Include idTagInfo if idTag was provided
  const response = {};
  if (idTag) {
    response.idTagInfo = {
      status: AuthorizationStatus.ACCEPTED,
    };
  }

  sendCallResult(ws, messageId, response);
}

/**
 * Process transactionData (historical meter values)
 * 
 * Some chargers send all meter values collected during the session
 * in the StopTransaction message.
 */
async function processTransactionData(chargerId, transactionId, transactionData) {
  if (!transactionData || transactionData.length === 0) {
    return;
  }

  console.log(`[STOP] Processing ${transactionData.length} historical meter values`);

  // Process each meter value entry
  for (const meterValue of transactionData) {
    if (!meterValue.sampledValue) continue;

    // Find energy reading
    const energyValue = meterValue.sampledValue.find(
      (v) => v.measurand === "Energy.Active.Import.Register" || !v.measurand
    );

    if (energyValue) {
      const meterWh = parseInt(energyValue.value);
      
      if (isNaN(meterWh)) {
        console.warn(`[STOP] Invalid meter value: ${energyValue.value}`);
        continue;
      }
      
      // Process billing for this reading
      // Idempotency key based on timestamp ensures no duplicates
      try {
        await billingService.processMeterValuesBilling({
          chargerId,
          transactionId,
          currentMeterWh: meterWh,
        });
      } catch (error) {
        console.error(`[STOP] Historical billing error:`, error.message);
        // Continue processing other values
      }
    }
  }
}
