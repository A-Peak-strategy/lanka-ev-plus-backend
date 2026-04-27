import prisma from "../config/db.js";
import Decimal from "decimal.js";
import walletService from "./wallet.service.js";
import ledgerService, {
  generateIdempotencyKey,
  recordOwnerEarning,
  recordCommission,
} from "./ledger.service.js";
import { startGracePeriod, cancelGracePeriod } from "./gracePeriod.service.js";
import notificationService from "./notification.service.js";

// Configure Decimal.js
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/**
 * Billing Service
 * 
 * Handles:
 * - Per-kWh pricing calculations
 * - Real-time deductions during charging (per MeterValues)
 * - Grace period management
 * - Owner earnings and commission split
 */

/**
 * Get pricing configuration for a charger
 * 
 * @param {string} chargerId
 * @returns {Promise<object>} Pricing configuration
 */
export async function getPricingForCharger(chargerId) {
  const charger = await prisma.charger.findUnique({
    where: { id: chargerId },
    include: {
      station: {
        include: {
          pricing: true,
        },
      },
    },
  });

  // Use station-specific pricing or default pricing
  if (charger?.station?.pricing) {
    return charger.station.pricing;
  }

  // Fallback to default pricing
  const defaultPricing = await prisma.pricing.findFirst({
    where: { isDefault: true, isActive: true },
  });

  if (!defaultPricing) {
    // Create default pricing if none exists
    // Per SRS: Commission = 2%
    return await prisma.pricing.create({
      data: {
        name: "Default Pricing",
        pricePerKwh: 50.0, // LKR 50 per kWh
        commissionRate: 2.0, // 2% commission per SRS
        gracePeriodSec: 60, // 60 seconds
        lowBalanceThreshold: 300.0, // LKR 300 - warning notification
        graceStartThreshold: 100.0, // LKR 100 - grace period starts
        isDefault: true,
        isActive: true,
      },
    });
  }

  return defaultPricing;
}

/**
 * Calculate cost for energy consumed
 * 
 * @param {number} energyWh - Energy in Watt-hours
 * @param {Decimal|number} pricePerKwh - Price per kWh
 * @returns {Decimal} Total cost
 */
export function calculateEnergyCost(energyWh, pricePerKwh) {
  const energyKwh = new Decimal(energyWh).dividedBy(1000);
  const price = new Decimal(pricePerKwh);
  return energyKwh.times(price);
}

/**
 * Calculate owner earning and commission split
 * 
 * @param {Decimal|number} totalAmount - Total charge amount
 * @param {Decimal|number} commissionRate - Commission percentage
 * @returns {object} Split amounts
 */
export function calculateEarningsSplit(totalAmount, commissionRate) {
  const total = new Decimal(totalAmount);
  const rate = new Decimal(commissionRate).dividedBy(100);

  const commission = total.times(rate);
  const ownerEarning = total.minus(commission);

  return {
    total: total.toFixed(2),
    commission: commission.toFixed(2),
    ownerEarning: ownerEarning.toFixed(2),
    commissionRate: commissionRate.toString(),
  };
}

/**
 * Process billing for MeterValues update
 * 
 * This is called on every MeterValues message to:
 * 1. Calculate incremental energy consumed
 * 2. Calculate cost for incremental energy
 * 3. Deduct from user wallet
 * 4. Handle low balance / grace period
 * 
 * @param {object} params
 * @param {string} params.chargerId
 * @param {string} params.transactionId
 * @param {number} params.currentMeterWh - Current meter reading
 * @returns {Promise<object>} Billing result
 */
export async function processMeterValuesBilling({
  chargerId,
  transactionId,
  currentMeterWh,
}) {
  // Get session
  const session = await prisma.chargingSession.findUnique({
    where: { transactionId },
    include: {
      user: true,
      charger: {
        include: {
          station: {
            include: {
              pricing: true,
              owner: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    return { success: false, error: "Session not found" };
  }

  if (!session.userId) {
    // No user associated - calculate energy and cost for tracking, but skip wallet/ledger
    const lastBilledWh = session.lastBilledWh || session.meterStartWh || 0;
    const incrementalWh = currentMeterWh - lastBilledWh;

    if (incrementalWh <= 0) {
      return { success: true, skipped: true, reason: "No new energy to bill" };
    }

    const pricing = await getPricingForCharger(chargerId);
    const pricePerKwh = new Decimal(pricing.pricePerKwh.toString());
    const incrementalCost = calculateEnergyCost(incrementalWh, pricePerKwh);

    const totalEnergyUsed = currentMeterWh - (session.meterStartWh || 0);
    const newTotalCost = new Decimal(session.totalCost?.toString() || "0").plus(incrementalCost);

    await prisma.chargingSession.update({
      where: { transactionId },
      data: {
        lastBilledWh: currentMeterWh,
        energyUsedWh: totalEnergyUsed,
        totalCost: newTotalCost.toFixed(2),
      },
    });

    return { success: true, skipped: true, reason: "No user associated, stats updated" };
  }

  // Calculate incremental energy
  const lastBilledWh = session.lastBilledWh || session.meterStartWh || 0;
  const incrementalWh = currentMeterWh - lastBilledWh;

  if (incrementalWh <= 0) {
    return { success: true, skipped: true, reason: "No new energy to bill" };
  }

  // Get pricing
  const pricing = await getPricingForCharger(chargerId);
  const pricePerKwh = new Decimal(pricing.pricePerKwh.toString());
  const commissionRate = new Decimal(pricing.commissionRate.toString());

  // Calculate cost for incremental energy
  const incrementalCost = calculateEnergyCost(incrementalWh, pricePerKwh);

  if (incrementalCost.lte(0)) {
    return { success: true, skipped: true, reason: "Zero cost increment" };
  }

  // Generate idempotency key for this specific meter reading
  const idempotencyKey = generateIdempotencyKey(
    "charging",
    transactionId,
    currentMeterWh.toString()
  );

  // Attempt wallet deduction
  const deductResult = await walletService.deductForCharging({
    userId: session.userId,
    amount: incrementalCost.toFixed(2),
    transactionId,
    idempotencyKey,
    energyWh: incrementalWh,
    chargerId,
    pricePerKwh: pricePerKwh.toFixed(2),
  });

  // Note: deductForCharging no longer checks for duplicates via ledger.
  // Duplicate billing is prevented by the lastBilledWh check above.

  if (deductResult.insufficientFunds) {
    // Handle low balance
    return await handleInsufficientFunds({
      session,
      pricing,
      currentMeterWh,
      requiredAmount: incrementalCost.toFixed(2),
      currentBalance: deductResult.currentBalance,
    });
  }

  if (!deductResult.success) {
    return deductResult;
  }

  // Calculate owner earning and commission
  const split = calculateEarningsSplit(incrementalCost, commissionRate);

  // Update session with new billing info
  const totalEnergyUsed = currentMeterWh - (session.meterStartWh || 0);
  const newTotalCost = new Decimal(session.totalCost.toString())
    .plus(incrementalCost);
  const newOwnerEarning = new Decimal(session.ownerEarning.toString())
    .plus(new Decimal(split.ownerEarning));
  const newCommission = new Decimal(session.commission.toString())
    .plus(new Decimal(split.commission));

  await prisma.chargingSession.update({
    where: { transactionId },
    data: {
      lastBilledWh: currentMeterWh,
      energyUsedWh: totalEnergyUsed,
      totalCost: newTotalCost.toFixed(2),
      ownerEarning: newOwnerEarning.toFixed(2),
      commission: newCommission.toFixed(2),
    },
  });

  // NOTE: Owner earning and commission are NO LONGER recorded per MeterValues.
  // They are created as consolidated entries at session end in finalizeSessionBilling().

  // Check balance thresholds
  const remainingBalance = new Decimal(deductResult.newBalance);
  const lowThreshold = new Decimal(pricing.lowBalanceThreshold.toString());
  const graceThreshold = new Decimal((pricing.graceStartThreshold || 100).toString());

  // If balance drops below grace threshold (LKR 100) → start grace period immediately
  if (remainingBalance.lte(graceThreshold) && remainingBalance.gt(0)) {
    // Start grace period even though user still has some balance
    if (!session.graceStartedAt) {
      const gracePeriodSec = pricing.gracePeriodSec;

      const graceResult = await startGracePeriod({
        sessionId: session.id,
        transactionId: session.transactionId,
        userId: session.userId,
        gracePeriodSec,
        chargerId,
      });

      await prisma.chargingSession.update({
        where: { id: session.id },
        data: {
          graceStartedAt: new Date(),
          gracePeriodSec,
        },
      });

      await notificationService.sendGracePeriodStarted({
        userId: session.userId,
        transactionId: session.transactionId,
        gracePeriodSec,
        requiredAmount: graceThreshold.toFixed(2),
        currentBalance: remainingBalance.toFixed(2),
      });

      console.log(`[BILLING] Grace period started: balance LKR ${remainingBalance.toFixed(2)} <= threshold LKR ${graceThreshold.toFixed(2)}`);
    }
  } else if (remainingBalance.lte(lowThreshold) && remainingBalance.gt(graceThreshold)) {
    // Balance between grace threshold and low threshold → send warning only
    await notificationService.sendLowBalanceWarning({
      userId: session.userId,
      balance: remainingBalance.toFixed(2),
      threshold: lowThreshold.toFixed(2),
      transactionId,
    });
  } else if (remainingBalance.gt(lowThreshold)) {
    // Balance above low threshold → cancel any existing grace period
    await cancelGracePeriod(transactionId);
  }

  // Check if preset budget is consumed → auto-stop charger
  if (session.presetAmount) {
    const presetBudget = new Decimal(session.presetAmount.toString());
    if (newTotalCost.gte(presetBudget)) {
      console.log(`[BILLING] Preset budget reached: LKR ${newTotalCost.toFixed(2)} >= LKR ${presetBudget.toFixed(2)} → auto-stopping charger ${chargerId}`);

      // Fire-and-forget: send RemoteStopTransaction
      const targetConnectorId = session.connector?.connectorId;
      import("../ocpp/commands/remoteStopTransaction.js").then(({ stopChargingAtCharger }) => {
        stopChargingAtCharger(chargerId, targetConnectorId).catch(err =>
          console.error(`[BILLING] Auto-stop failed:`, err.message)
        );
      });

      // Notify user
      notificationService.sendChargingComplete({
        userId: session.userId,
        transactionId,
        energyUsedWh: totalEnergyUsed,
        totalCost: newTotalCost.toFixed(2),
        reason: 'Preset budget reached',
      }).catch(err => console.error(`[BILLING] Notification error:`, err.message));
    }
  }

  return {
    success: true,
    incrementalWh,
    incrementalCost: incrementalCost.toFixed(2),
    newBalance: deductResult.newBalance,
    totalCost: newTotalCost.toFixed(2),
    split,
  };
}

/**
 * Handle insufficient funds during charging
 * 
 * @param {object} params
 * @returns {Promise<object>} Handling result
 */
async function handleInsufficientFunds({
  session,
  pricing,
  currentMeterWh,
  requiredAmount,
  currentBalance,
}) {
  const gracePeriodSec = pricing.gracePeriodSec;

  // Check if grace period already started
  if (session.graceStartedAt) {
    // Grace period is managed by worker - just return status
    return {
      success: true,
      insufficientFunds: true,
      graceActive: true,
      graceStartedAt: session.graceStartedAt,
      gracePeriodSec,
      requiredAmount,
      currentBalance,
    };
  }

  // Start grace period
  const graceResult = await startGracePeriod({
    sessionId: session.id,
    transactionId: session.transactionId,
    userId: session.userId,
    gracePeriodSec,
    chargerId: session.chargerId,
  });

  // Update session
  await prisma.chargingSession.update({
    where: { id: session.id },
    data: {
      graceStartedAt: new Date(),
      gracePeriodSec,
    },
  });

  // Send notification
  await notificationService.sendGracePeriodStarted({
    userId: session.userId,
    transactionId: session.transactionId,
    gracePeriodSec,
    requiredAmount,
    currentBalance,
  });

  return {
    success: true,
    insufficientFunds: true,
    graceStarted: true,
    gracePeriodSec,
    requiredAmount,
    currentBalance,
    graceExpiresAt: graceResult.expiresAt,
  };
}

/**
 * Finalize billing for a completed session
 * 
 * Creates consolidated ledger entries:
 * 1. ONE CHARGE_DEBIT for the user (total session cost)
 * 2. ONE OWNER_EARNING for the station owner
 * 3. ONE COMMISSION deducted from admin wallet
 * 
 * Wallet balance was already deducted in real-time during charging.
 * These entries are the audit trail.
 * 
 * @param {string} transactionId
 * @returns {Promise<object>} Final billing summary
 */
export async function finalizeSessionBilling(transactionId) {
  const session = await prisma.chargingSession.findUnique({
    where: { transactionId },
    include: {
      user: true,
      charger: {
        include: {
          station: {
            include: {
              pricing: true,
              owner: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw new Error("Session not found");
  }

  // Cancel any active grace period
  await cancelGracePeriod(transactionId);

  // Clear grace period from session
  await prisma.chargingSession.update({
    where: { transactionId },
    data: {
      graceStartedAt: null,
      gracePeriodSec: null,
    },
  });

  // --- Create consolidated ledger entries ---
  const totalCost = new Decimal(session.totalCost.toString());
  const ownerEarning = new Decimal(session.ownerEarning.toString());
  const commission = new Decimal(session.commission.toString());

  // Only create entries if there was actual cost
  if (totalCost.gt(0) && session.userId) {
    const chargerId = session.chargerId || 'Unknown';
    const energyKwh = ((session.energyUsedWh || 0) / 1000).toFixed(2);
    const pricing = session.charger?.station?.pricing;
    const pricePerKwh = pricing ? pricing.pricePerKwh.toString() : '?';

    // Calculate duration
    const startTime = session.startedAt || session.createdAt;
    const endTime = session.endedAt || new Date();
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationMins = Math.round(durationMs / 60000);

    // Get current wallet balance for balanceAfter
    const wallet = await prisma.wallet.findUnique({ where: { userId: session.userId } });
    const currentBalance = wallet ? new Decimal(wallet.balance.toString()) : new Decimal(0);

    // 1. Consolidated CHARGE_DEBIT for user
    const userIdempotencyKey = `session-final:${transactionId}:user`;
    const existingUserEntry = await prisma.ledger.findUnique({ where: { idempotencyKey: userIdempotencyKey } });

    if (!existingUserEntry) {
      const description = `Charging Session · ${chargerId} · ${energyKwh} kWh @ LKR ${pricePerKwh}/kWh · ${durationMins} mins`;

      await prisma.ledger.create({
        data: {
          userId: session.userId,
          type: 'CHARGE_DEBIT',
          amount: totalCost.toFixed(2),
          balanceAfter: currentBalance.toFixed(2),
          referenceId: String(transactionId),
          referenceType: 'CHARGING_SESSION',
          description,
          idempotencyKey: userIdempotencyKey,
          metadata: {
            transactionId,
            sessionId: session.id,
            chargerId,
            energyUsedWh: session.energyUsedWh,
            energyKwh,
            pricePerKwh,
            durationMins,
            totalCost: totalCost.toFixed(2),
          },
        },
      });

      console.log(`[BILLING] Created consolidated CHARGE_DEBIT: LKR ${totalCost.toFixed(2)} for session ${transactionId}`);
    }

    // 2. Consolidated OWNER_EARNING for station owner
    const ownerId = session.charger?.station?.ownerId;
    if (ownerId && ownerEarning.gt(0)) {
      await recordOwnerEarning({
        ownerId,
        amount: ownerEarning.toFixed(2),
        transactionId,
        sessionId: session.id,
        idempotencyKey: `session-final:${transactionId}:owner`,
      });

      console.log(`[BILLING] Created consolidated OWNER_EARNING: LKR ${ownerEarning.toFixed(2)} for owner ${ownerId}`);
    }

    // 3. Consolidated COMMISSION deducted from admin
    if (ownerId && commission.gt(0)) {
      await recordCommission({
        ownerId,
        amount: commission.toFixed(2),
        transactionId,
        sessionId: session.id,
        idempotencyKey: `session-final:${transactionId}:commission`,
      });

      console.log(`[BILLING] Created consolidated COMMISSION: LKR ${commission.toFixed(2)}`);
    }
  }

  // Unlock reserved funds from wallet if presetAmount was set
  if (session.presetAmount && session.userId) {
    try {
      await walletService.unlockFunds(
        session.userId,
        session.presetAmount.toString()
      );
      console.log(`[BILLING] Unlocked LKR ${session.presetAmount} for user ${session.userId}`);
    } catch (unlockErr) {
      console.error(`[BILLING] Failed to unlock funds:`, unlockErr.message);
    }
  }

  return {
    transactionId,
    energyUsedWh: session.energyUsedWh,
    totalCost: totalCost.toFixed(2),
    ownerEarning: ownerEarning.toFixed(2),
    commission: commission.toFixed(2),
  };
}

/**
 * Handle wallet top-up during active session
 * 
 * This cancels any active grace period when user tops up
 * 
 * @param {string} userId
 * @returns {Promise<object>} Result
 */
export async function handleWalletTopUpDuringSession(userId) {
  // Find any active sessions for this user
  const activeSessions = await prisma.chargingSession.findMany({
    where: {
      userId,
      endedAt: null,
      graceStartedAt: { not: null },
    },
  });

  for (const session of activeSessions) {
    // Cancel grace period
    await cancelGracePeriod(session.transactionId);

    // Clear grace period from session
    await prisma.chargingSession.update({
      where: { id: session.id },
      data: {
        graceStartedAt: null,
        gracePeriodSec: null,
      },
    });

    // Notify user
    await notificationService.sendGracePeriodCancelled({
      userId,
      transactionId: session.transactionId,
      reason: "Wallet topped up",
    });
  }

  return {
    success: true,
    sessionsUpdated: activeSessions.length,
  };
}

export default {
  getPricingForCharger,
  calculateEnergyCost,
  calculateEarningsSplit,
  processMeterValuesBilling,
  finalizeSessionBilling,
  handleWalletTopUpDuringSession,
};

