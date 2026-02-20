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
        lowBalanceThreshold: 50.0, // LKR 50
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
    // No user associated - skip billing (e.g., test transactions)
    return { success: true, skipped: true, reason: "No user associated" };
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
  });

  if (deductResult.duplicate) {
    return { success: true, duplicate: true };
  }

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

  // Record owner earning and commission in ledger (if station has owner)
  if (session.charger?.station?.ownerId) {
    const ownerId = session.charger.station.ownerId;
    
    await recordOwnerEarning({
      ownerId,
      amount: split.ownerEarning,
      transactionId,
      sessionId: session.id,
      idempotencyKey: `${idempotencyKey}:owner`,
    });

    await recordCommission({
      ownerId,
      amount: split.commission,
      transactionId,
      sessionId: session.id,
      idempotencyKey: `${idempotencyKey}:commission`,
    });
  }

  // Check for low balance warning
  const remainingBalance = new Decimal(deductResult.newBalance);
  const lowThreshold = new Decimal(pricing.lowBalanceThreshold.toString());

  if (remainingBalance.lte(lowThreshold) && remainingBalance.gt(0)) {
    await notificationService.sendLowBalanceWarning({
      userId: session.userId,
      balance: remainingBalance.toFixed(2),
      threshold: lowThreshold.toFixed(2),
      transactionId,
    });
  }

  // Cancel any existing grace period (user has balance)
  await cancelGracePeriod(transactionId);

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
 * @param {string} transactionId
 * @returns {Promise<object>} Final billing summary
 */
export async function finalizeSessionBilling(transactionId) {
  const session = await prisma.chargingSession.findUnique({
    where: { transactionId },
    include: {
      charger: {
        include: {
          station: true,
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

  return {
    transactionId,
    energyUsedWh: session.energyUsedWh,
    totalCost: session.totalCost.toString(),
    ownerEarning: session.ownerEarning.toString(),
    commission: session.commission.toString(),
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

