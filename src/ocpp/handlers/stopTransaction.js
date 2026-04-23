import { sendCallResult } from "../messageQueue.js";
import { AuthorizationStatus } from "../ocppConstants.js";
import { getConnectorState, updateConnectorState, getAllConnectorStates } from "../../services/chargerStore.service.js";
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
 * This handler now resets ONLY the target connector's state, leaving other
 * connectors unaffected.
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

  // Resolve OCPP integer transactionId to internal string transactionId
  // AND determine which connector this transaction belongs to
  const { activeTransactionId, connectorId } = await resolveTransaction(chargerId, transactionId);

  if (!activeTransactionId) {
    console.warn(`[STOP] No active transaction found for ${chargerId}`);
    sendCallResult(ws, messageId, {});
    return;
  }

  console.log(`[STOP] Resolved: connector=${connectorId}, internal=${activeTransactionId}`);

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
    const { session, alreadyFinalized, notFound } = await sessionService.finalizeSession({
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
    if (connectorId) {
      await connectorLockService.markChargingComplete(
        chargerId,
        connectorId,
        activeTransactionId
      ).catch(err => console.error(`[STOP] Lock release error:`, err.message));
    }

    // Reset ONLY this connector's state — other connectors are unaffected
    await updateConnectorState(chargerId, connectorId, {
      status: "Available",
      transactionId: null,
      internalTransactionId: null,
      ocppTransactionId: null,
      meterStartWh: null,
      lastMeterValueWh: null,
      idTag: null,
      userId: null,
      sessionStartTime: null,
      bookingId: null,
    });

    console.log(`✅ [STOP] Transaction ${activeTransactionId} completed on connector ${connectorId}: ` +
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
    
    // Still try to reset this connector's state to prevent stuck state
    await updateConnectorState(chargerId, connectorId, {
      status: "Available",
      transactionId: null,
      internalTransactionId: null,
      ocppTransactionId: null,
    }).catch(() => {});
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
 * Resolve OCPP transactionId to internal transactionId + connectorId.
 *
 * Search order:
 *   1. In-memory connector states (fastest)
 *   2. DB session lookup by session.id (the OCPP integer)
 */
async function resolveTransaction(chargerId, ocppTxId) {
  // 1. Search in-memory connector states
  const connMap = await getAllConnectorStates(chargerId);
  if (connMap && connMap.size > 0) {
    for (const [connId, state] of connMap) {
      if (state?.ocppTransactionId === ocppTxId || state?.transactionId === ocppTxId) {
        return {
          activeTransactionId: state.transactionId,
          connectorId: connId,
        };
      }
    }
  }

  // 2. DB lookup by session.id (the integer we sent to charger)
  if (ocppTxId) {
    const session = await prisma.chargingSession.findUnique({
      where: { id: parseInt(ocppTxId) },
      include: {
        connector: {
          select: { connectorId: true },
        },
      },
    });
    if (session) {
      const connId = session.connector?.connectorId ?? 1;
      console.log(`[STOP] Resolved ocppTxId ${ocppTxId} → internal ${session.transactionId}, connector ${connId}`);
      return {
        activeTransactionId: session.transactionId,
        connectorId: connId,
      };
    }
  }

  return { activeTransactionId: null, connectorId: 1 };
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
