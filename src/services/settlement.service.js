import prisma from "../config/db.js";
import Decimal from "decimal.js";
import { createLedgerEntry } from "./ledger.service.js";

/**
 * Settlement Service
 * 
 * Handles owner earnings and bi-weekly payouts:
 * - Calculate earnings per session
 * - Apply 2% commission
 * - Store earnings in ledger
 * - Create bi-weekly settlements
 * - Process payouts with immutable audit trail
 */

// Default commission rate (2% per SRS)
const DEFAULT_COMMISSION_RATE = new Decimal("2.00");

// ============================================
// EARNINGS CALCULATION
// ============================================

/**
 * Calculate owner earnings and commission for a session
 * 
 * @param {object} session - Charging session
 * @param {Decimal} totalCost - Total cost of the session
 * @param {number} commissionRate - Commission rate percentage
 * @returns {object} { ownerEarning, commission }
 */
export function calculateEarnings(totalCost, commissionRate = null) {
  const rate = commissionRate !== null
    ? new Decimal(commissionRate)
    : DEFAULT_COMMISSION_RATE;

  const total = new Decimal(totalCost.toString());
  const commissionAmount = total.times(rate).dividedBy(100);
  const ownerEarning = total.minus(commissionAmount);

  return {
    ownerEarning: ownerEarning.toFixed(2),
    commission: commissionAmount.toFixed(2),
  };
}

/**
 * Record owner earning for a completed session
 * 
 * Called when a session ends (StopTransaction)
 * 
 * @param {object} params
 * @param {number} params.sessionId
 * @param {string} params.transactionId
 * @param {string} params.ownerId
 * @param {Decimal} params.totalCost
 * @param {number} params.commissionRate
 * @returns {Promise<object>}
 */
export async function recordSessionEarning({
  sessionId,
  transactionId,
  ownerId,
  totalCost,
  commissionRate = null,
}) {
  const { ownerEarning, commission } = calculateEarnings(totalCost, commissionRate);

  // Create ledger entry for owner earning
  const earningEntry = await createLedgerEntry({
    userId: ownerId,
    type: "OWNER_EARNING",
    amount: ownerEarning,
    referenceId: transactionId,
    referenceType: "CHARGING_SESSION",
    description: `Earning from session ${transactionId}`,
    idempotencyKey: `owner_earning_${transactionId}`,
    metadata: {
      sessionId,
      grossAmount: totalCost.toString(),
      commissionRate: commissionRate?.toString() || DEFAULT_COMMISSION_RATE.toString(),
    },
  });

  // Create ledger entry for commission
  const commissionEntry = await createLedgerEntry({
    userId: "PLATFORM", // Platform's internal account
    type: "COMMISSION",
    amount: commission,
    referenceId: transactionId,
    referenceType: "CHARGING_SESSION",
    description: `Commission from session ${transactionId}`,
    idempotencyKey: `commission_${transactionId}`,
    metadata: {
      sessionId,
      ownerId,
      grossAmount: totalCost.toString(),
    },
  });

  // Update session with earnings
  await prisma.chargingSession.update({
    where: { id: sessionId },
    data: {
      ownerEarning: new Decimal(ownerEarning),
      commission: new Decimal(commission),
    },
  });

  return {
    ownerEarning,
    commission,
    earningEntry,
    commissionEntry,
  };
}

// ============================================
// SETTLEMENT CREATION
// ============================================

/**
 * Create a bi-weekly settlement for an owner
 * 
 * @param {string} ownerId
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @returns {Promise<object>}
 */
export async function createSettlement(ownerId, periodStart, periodEnd) {
  // Get IDs of sessions that are already attached to any non-FAILED settlement
  const alreadySettledItems = await prisma.settlementItem.findMany({
    where: {
      settlement: {
        ownerId,
        status: { not: "FAILED" },
      },
    },
    select: { sessionId: true },
  });
  const settledSessionIds = alreadySettledItems.map((item) => item.sessionId);

  // Get all completed sessions for this owner's stations in the period,
  // excluding sessions that are already part of a non-FAILED settlement
  const sessions = await prisma.chargingSession.findMany({
    where: {
      endedAt: { not: null },
      startedAt: { gte: periodStart, lte: periodEnd },
      charger: {
        station: {
          ownerId,
        },
      },
      ...(settledSessionIds.length > 0 ? { id: { notIn: settledSessionIds } } : {}),
    },
    include: {
      charger: {
        include: {
          station: true,
        },
      },
    },
  });

  if (sessions.length === 0) {
    return null; // No unsettled sessions in this period
  }

  // Calculate totals from sessions
  let totalEarnings = new Decimal(0);
  let totalCommission = new Decimal(0);
  let totalEnergyWh = 0;

  const settlementItems = sessions.map((session) => {
    const earning = new Decimal(session.ownerEarning?.toString() || "0");
    const commission = new Decimal(session.commission?.toString() || "0");
    const gross = earning.plus(commission);

    totalEarnings = totalEarnings.plus(earning);
    totalCommission = totalCommission.plus(commission);
    totalEnergyWh += session.energyUsedWh || 0;

    return {
      sessionId: session.id,
      transactionId: session.transactionId,
      energyWh: session.energyUsedWh || 0,
      grossAmount: gross,
      commission,
      netAmount: earning,
      sessionDate: session.startedAt,
    };
  });

  // Deduct any amounts already paid out (manual ad-hoc payments or previous batch payments)
  // so the new settlement only covers what's still owed
  const paidSettlements = await prisma.settlement.findMany({
    where: { ownerId, status: "PAID" },
  });
  let alreadyPaidOut = new Decimal(0);
  for (const ps of paidSettlements) {
    alreadyPaidOut = alreadyPaidOut.plus(new Decimal(ps.netPayout.toString()));
  }

  // Also account for any existing PENDING settlements (to avoid overlap)
  const pendingSettlements = await prisma.settlement.findMany({
    where: { ownerId, status: "PENDING" },
  });
  let alreadyPending = new Decimal(0);
  for (const ps of pendingSettlements) {
    alreadyPending = alreadyPending.plus(new Decimal(ps.netPayout.toString()));
  }

  // netPayout = what these sessions earned - what's already been paid/pending
  const netPayout = totalEarnings.minus(alreadyPaidOut).minus(alreadyPending);

  if (netPayout.lte(0)) {
    console.log(`[SETTLEMENT] No payout needed for owner ${ownerId}: sessions earned ${totalEarnings.toFixed(2)}, already paid ${alreadyPaidOut.toFixed(2)}, already pending ${alreadyPending.toFixed(2)}`);
    return null;
  }

  // Create settlement with items in a transaction
  const settlement = await prisma.$transaction(async (tx) => {
    const created = await tx.settlement.create({
      data: {
        ownerId,
        periodStart,
        periodEnd,
        totalEarnings,
        totalCommission,
        netPayout,
        sessionCount: sessions.length,
        totalEnergyWh,
        status: "PENDING",
        paymentNotes: alreadyPaidOut.gt(0) ? `Adjusted: LKR ${alreadyPaidOut.toFixed(2)} already paid out` : null,
      },
    });

    // Create line items
    for (const item of settlementItems) {
      await tx.settlementItem.create({
        data: {
          settlementId: created.id,
          sessionId: item.sessionId,
          transactionId: item.transactionId,
          energyWh: item.energyWh,
          grossAmount: item.grossAmount,
          commission: item.commission,
          netAmount: item.netAmount,
          sessionDate: item.sessionDate,
        },
      });
    }

    return created;
  });

  return settlement;
}

/**
 * Generate settlements for all owners
 * 
 * Accepts optional custom date range from the admin panel.
 * Falls back to the last 14-day period if no dates are provided.
 * 
 * @param {string|Date} [customStart] - Custom period start date
 * @param {string|Date} [customEnd] - Custom period end date
 * @returns {Promise<object[]>}
 */
export async function generateBiWeeklySettlements(customStart, customEnd) {
  let periodStart, periodEnd;

  if (customStart && customEnd) {
    // Use the admin-provided dates
    periodStart = new Date(customStart);
    periodStart.setHours(0, 0, 0, 0);
    periodEnd = new Date(customEnd);
    periodEnd.setHours(23, 59, 59, 999);
  } else {
    // Default: last 14-day period ending yesterday
    const now = new Date();
    periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() - 1);
    periodEnd.setHours(23, 59, 59, 999);

    periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() - 13);
    periodStart.setHours(0, 0, 0, 0);
  }

  console.log(`[SETTLEMENT] Generating settlements for period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

  // Get all active owners with stations
  const owners = await prisma.user.findMany({
    where: {
      role: "OWNER",
      isActive: true,
      ownedStations: {
        some: { isActive: true },
      },
    },
  });

  const settlements = [];
  const errors = [];

  for (const owner of owners) {
    try {
      const settlement = await createSettlement(owner.id, periodStart, periodEnd);
      if (settlement) {
        settlements.push(settlement);
      }
    } catch (error) {
      console.error(`Failed to create settlement for owner ${owner.id}:`, error);
      errors.push({ ownerId: owner.id, error: error.message });
    }
  }

  return { settlements, errors, periodStart, periodEnd };
}

// ============================================
// PAYOUT PROCESSING
// ============================================

/**
 * Mark settlement as paid (admin action)
 * 
 * @param {string} settlementId
 * @param {object} paymentDetails
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function markSettlementAsPaid(settlementId, paymentDetails, adminId) {
  const { paymentRef, paymentMethod, paymentNotes } = paymentDetails;

  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
  });

  if (!settlement) {
    throw new Error("Settlement not found");
  }

  if (settlement.status === "PAID") {
    throw new Error("Settlement already paid");
  }

  if (settlement.status === "FAILED") {
    throw new Error("Cannot pay a failed settlement");
  }

  // Update settlement status
  const updated = await prisma.settlement.update({
    where: { id: settlementId },
    data: {
      status: "PAID",
      paidAt: new Date(),
      paidByAdminId: adminId,
      paymentRef,
      paymentMethod,
      paymentNotes,
    },
  });

  // Create ledger entry for payout
  await createLedgerEntry({
    userId: settlement.ownerId,
    type: "SETTLEMENT_PAYOUT",
    amount: settlement.netPayout,
    referenceId: settlementId,
    referenceType: "SETTLEMENT",
    description: `Settlement payout - ${paymentMethod || "Bank Transfer"}`,
    idempotencyKey: `settlement_payout_${settlementId}`,
    metadata: {
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
      sessionCount: settlement.sessionCount,
      paymentRef,
      paidByAdminId: adminId,
    },
  });

  // Log admin action
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: "MARK_SETTLEMENT_PAID",
      targetType: "SETTLEMENT",
      targetId: settlementId,
      previousValue: { status: settlement.status },
      newValue: { status: "PAID", paymentRef, paymentMethod },
    },
  });

  return updated;
}

/**
 * Mark settlement as failed
 * 
 * @param {string} settlementId
 * @param {string} reason
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function markSettlementAsFailed(settlementId, reason, adminId) {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
  });

  if (!settlement) {
    throw new Error("Settlement not found");
  }

  if (settlement.status === "PAID") {
    throw new Error("Cannot mark paid settlement as failed");
  }

  const updated = await prisma.settlement.update({
    where: { id: settlementId },
    data: {
      status: "FAILED",
      paymentNotes: reason,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: "MARK_SETTLEMENT_FAILED",
      targetType: "SETTLEMENT",
      targetId: settlementId,
      previousValue: { status: settlement.status },
      newValue: { status: "FAILED", reason },
    },
  });

  return updated;
}

// ============================================
// SETTLEMENT QUERIES
// ============================================

/**
 * Get settlements with filters
 * 
 * @param {object} filters
 * @returns {Promise<object[]>}
 */
export async function getSettlements(filters = {}) {
  const { ownerId, status, startDate, endDate, limit = 50, offset = 0 } = filters;

  const where = {};
  if (ownerId) where.ownerId = ownerId;
  if (status) where.status = status;

  if (startDate || endDate) {
    where.periodStart = {};
    if (startDate) where.periodStart.gte = new Date(startDate);
    if (endDate) where.periodStart.lte = new Date(endDate);
  }

  const settlements = await prisma.settlement.findMany({
    where,
    include: {
      items: {
        take: 10, // Limit items for list view
      },
    },
    orderBy: { periodStart: "desc" },
    take: limit,
    skip: offset,
  });

  // Enrich with owner names
  const ownerIds = [...new Set(settlements.map((s) => s.ownerId))];
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true, email: true },
  });
  const ownerMap = Object.fromEntries(owners.map((o) => [o.id, o]));

  return settlements.map((s) => ({
    ...s,
    owner: ownerMap[s.ownerId] || { name: null, email: null },
  }));
}

/**
 * Get settlement by ID with full details
 * 
 * @param {string} settlementId
 * @returns {Promise<object>}
 */
export async function getSettlementById(settlementId) {
  return prisma.settlement.findUnique({
    where: { id: settlementId },
    include: {
      items: {
        orderBy: { sessionDate: "desc" },
      },
    },
  });
}

/**
 * Get pending settlements summary
 * 
 * @returns {Promise<object>}
 */
export async function getPendingSettlementsSummary() {
  const pending = await prisma.settlement.findMany({
    where: { status: "PENDING" },
  });

  let totalAmount = new Decimal(0);
  let totalSessions = 0;

  for (const s of pending) {
    totalAmount = totalAmount.plus(new Decimal(s.netPayout.toString()));
    totalSessions += s.sessionCount;
  }

  return {
    count: pending.length,
    totalAmount: totalAmount.toFixed(2),
    totalSessions,
  };
}

/**
 * Get owner earnings summary
 * 
 * @param {string} ownerId
 * @param {object} options - { startDate, endDate }
 * @returns {Promise<object>}
 */
export async function getOwnerEarningsSummary(ownerId, options = {}) {
  const { startDate, endDate } = options;

  // Build date filter for sessions
  const sessionDateFilter = {};
  if (startDate) sessionDateFilter.gte = new Date(startDate);
  if (endDate) sessionDateFilter.lte = new Date(endDate);

  const sessionWhere = {
    charger: {
      station: { ownerId },
    },
    endedAt: { not: null },
  };
  if (startDate || endDate) {
    sessionWhere.startedAt = sessionDateFilter;
  }

  // Get earnings from sessions (filtered by date)
  const sessions = await prisma.chargingSession.aggregate({
    where: sessionWhere,
    _sum: {
      ownerEarning: true,
      commission: true,
      energyUsedWh: true,
      totalCost: true,
    },
    _count: { id: true },
  });

  // Get pending payout amount (all-time, not date-filtered)
  const pendingSettlements = await prisma.settlement.findMany({
    where: {
      ownerId,
      status: "PENDING",
    },
  });

  let pendingPayout = new Decimal(0);
  for (const s of pendingSettlements) {
    pendingPayout = pendingPayout.plus(new Decimal(s.netPayout.toString()));
  }

  // Get total paid out (all-time)
  const paidSettlements = await prisma.settlement.findMany({
    where: {
      ownerId,
      status: "PAID",
    },
  });

  let totalPaidOut = new Decimal(0);
  for (const s of paidSettlements) {
    totalPaidOut = totalPaidOut.plus(new Decimal(s.netPayout.toString()));
  }

  // All-time total earnings for balance calculation
  const allTimeSessions = startDate || endDate
    ? await prisma.chargingSession.aggregate({
      where: {
        charger: { station: { ownerId } },
        endedAt: { not: null },
      },
      _sum: { ownerEarning: true },
    })
    : sessions;

  const allTimeEarnings = new Decimal(allTimeSessions._sum.ownerEarning?.toString() || "0");
  const remainingBalance = allTimeEarnings.minus(totalPaidOut).minus(pendingPayout);

  return {
    totalEarnings: sessions._sum.ownerEarning?.toString() || "0.00",
    totalCommissionPaid: sessions._sum.commission?.toString() || "0.00",
    totalRevenue: sessions._sum.totalCost?.toString() || "0.00",
    totalEnergyKwh: ((sessions._sum.energyUsedWh || 0) / 1000).toFixed(2),
    totalSessions: sessions._count.id,
    pendingPayout: pendingPayout.toFixed(2),
    totalPaidOut: totalPaidOut.toFixed(2),
    pendingSettlementsCount: pendingSettlements.length,
    allTimeEarnings: allTimeEarnings.toFixed(2),
    remainingBalance: remainingBalance.toFixed(2),
  };
}

/**
 * Get owner earnings broken down by station
 * 
 * @param {string} ownerId
 * @param {object} options - { startDate, endDate }
 * @returns {Promise<object>}
 */
export async function getOwnerEarningsByStation(ownerId, options = {}) {
  const { startDate, endDate } = options;

  // Build date filter
  const dateFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);

  // Get all stations for this owner
  const stations = await prisma.station.findMany({
    where: { ownerId },
    include: {
      chargers: {
        select: { id: true },
      },
    },
  });

  const stationEarnings = [];

  for (const station of stations) {
    const chargerIds = station.chargers.map((c) => c.id);

    if (chargerIds.length === 0) {
      stationEarnings.push({
        stationId: station.id,
        stationName: station.name,
        address: station.address,
        chargerCount: 0,
        totalSessions: 0,
        totalEnergyKwh: "0.00",
        grossRevenue: "0.00",
        totalCommission: "0.00",
        netEarnings: "0.00",
        isActive: station.isActive,
      });
      continue;
    }

    const aggWhere = {
      chargerId: { in: chargerIds },
      endedAt: { not: null },
    };
    if (startDate || endDate) {
      aggWhere.startedAt = dateFilter;
    }

    const agg = await prisma.chargingSession.aggregate({
      where: aggWhere,
      _sum: {
        totalCost: true,
        ownerEarning: true,
        commission: true,
        energyUsedWh: true,
      },
      _count: { id: true },
    });

    // Calculate unpaid usage: sessions with no userId (admin/debug starts)
    const unpaidAgg = await prisma.chargingSession.aggregate({
      where: {
        ...aggWhere,
        userId: null,
      },
      _sum: {
        totalCost: true,
      },
    });

    const grossRevenue = new Decimal(agg._sum.totalCost?.toString() || "0");
    const unpaidUsage = new Decimal(unpaidAgg._sum.totalCost?.toString() || "0");

    stationEarnings.push({
      stationId: station.id,
      stationName: station.name,
      address: station.address,
      chargerCount: chargerIds.length,
      totalSessions: agg._count.id,
      totalEnergyKwh: ((agg._sum.energyUsedWh || 0) / 1000).toFixed(2),
      grossRevenue: grossRevenue.toFixed(2),
      unpaidUsage: unpaidUsage.toFixed(2),
      totalCommission: agg._sum.commission?.toString() || "0.00",
      netEarnings: agg._sum.ownerEarning?.toString() || "0.00",
      isActive: station.isActive,
    });
  }

  return stationEarnings;
}

/**
 * Record a payment to an owner (admin action)
 * Creates a settlement and immediately marks it as paid
 * 
 * @param {string} ownerId
 * @param {object} paymentDetails
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function recordOwnerPayment(ownerId, paymentDetails, adminId) {
  const { amount, paymentRef, paymentMethod, paymentNotes } = paymentDetails;

  if (!amount || parseFloat(amount) <= 0) {
    throw new Error("Invalid payment amount");
  }

  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!owner || owner.role !== "OWNER") {
    throw new Error("Owner not found");
  }

  const paymentAmount = new Decimal(amount);
  const now = new Date();

  // Create settlement + mark paid in one transaction
  const settlement = await prisma.$transaction(async (tx) => {
    // Auto-cancel any PENDING settlements for this owner to prevent
    // double-subtraction from the remaining balance
    const pendingSettlements = await tx.settlement.findMany({
      where: { ownerId, status: "PENDING" },
    });

    if (pendingSettlements.length > 0) {
      await tx.settlement.updateMany({
        where: { ownerId, status: "PENDING" },
        data: {
          status: "FAILED",
          paymentNotes: "Auto-cancelled: superseded by manual payment",
        },
      });

      // Log each cancellation for audit trail
      for (const ps of pendingSettlements) {
        await tx.adminAuditLog.create({
          data: {
            adminId,
            action: "AUTO_CANCEL_PENDING_SETTLEMENT",
            targetType: "SETTLEMENT",
            targetId: ps.id,
            previousValue: JSON.stringify({ status: "PENDING", netPayout: ps.netPayout.toString() }),
            newValue: JSON.stringify({ status: "FAILED", reason: "Superseded by manual payment" }),
          },
        });
      }

      console.log(`[SETTLEMENT] Auto-cancelled ${pendingSettlements.length} PENDING settlement(s) for owner ${ownerId} due to manual payment`);
    }

    const created = await tx.settlement.create({
      data: {
        ownerId,
        periodStart: now,
        periodEnd: now,
        totalEarnings: paymentAmount,
        totalCommission: new Decimal(0),
        netPayout: paymentAmount,
        sessionCount: 0,
        totalEnergyWh: 0,
        status: "PAID",
        paidAt: now,
        paidByAdminId: adminId,
        paymentRef: paymentRef || null,
        paymentMethod: paymentMethod || "MANUAL",
        paymentNotes: paymentNotes || "Manual payment by admin",
      },
    });

    // Log admin action
    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: "RECORD_OWNER_PAYMENT",
        targetType: "SETTLEMENT",
        targetId: created.id,
        newValue: JSON.stringify({ amount: amount.toString(), paymentRef, paymentMethod }),
      },
    });

    return created;
  });

  return settlement;
}

/**
 * Reverse a manual owner payment (admin action)
 * Only allows reversing PAID settlements with sessionCount = 0 (manual payments)
 * 
 * @param {string} settlementId
 * @param {string} reason
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function reverseOwnerPayment(settlementId, reason, adminId) {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
  });

  if (!settlement) {
    throw new Error("Settlement not found");
  }

  if (settlement.status !== "PAID") {
    throw new Error("Can only reverse PAID settlements");
  }

  if (settlement.sessionCount > 0) {
    throw new Error("Cannot reverse a batch settlement. Use 'Mark as Failed' for batch settlements.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const reversed = await tx.settlement.update({
      where: { id: settlementId },
      data: {
        status: "FAILED",
        paymentNotes: `REVERSED: ${reason}. Original: ${settlement.paymentNotes || 'Manual payment'}`,
      },
    });

    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: "REVERSE_OWNER_PAYMENT",
        targetType: "SETTLEMENT",
        targetId: settlementId,
        previousValue: JSON.stringify({
          status: "PAID",
          netPayout: settlement.netPayout.toString(),
          paymentRef: settlement.paymentRef,
        }),
        newValue: JSON.stringify({
          status: "FAILED",
          reason,
        }),
      },
    });

    return reversed;
  });

  console.log(`[SETTLEMENT] Reversed manual payment ${settlementId}: LKR ${settlement.netPayout} for owner ${settlement.ownerId}`);

  return updated;
}

/**
 * Delete a settlement (admin action)
 * Only allows deleting FAILED settlements
 * 
 * @param {string} settlementId
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function deleteSettlement(settlementId, adminId) {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    include: { items: true },
  });

  if (!settlement) {
    throw new Error("Settlement not found");
  }

  if (settlement.status !== "FAILED") {
    throw new Error("Can only delete FAILED settlements. Mark it as failed first.");
  }

  await prisma.$transaction(async (tx) => {
    // Delete settlement items first (foreign key constraint)
    if (settlement.items.length > 0) {
      await tx.settlementItem.deleteMany({
        where: { settlementId },
      });
    }

    // Delete the settlement
    await tx.settlement.delete({
      where: { id: settlementId },
    });

    // Audit log
    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: "DELETE_SETTLEMENT",
        targetType: "SETTLEMENT",
        targetId: settlementId,
        previousValue: JSON.stringify({
          status: settlement.status,
          netPayout: settlement.netPayout.toString(),
          ownerId: settlement.ownerId,
          sessionCount: settlement.sessionCount,
        }),
      },
    });
  });

  console.log(`[SETTLEMENT] Deleted FAILED settlement ${settlementId} for owner ${settlement.ownerId}`);

  return { success: true, deletedId: settlementId };
}

/**
 * Get payment history for an owner
 * Returns all settlements (PAID, PENDING, FAILED) ordered by date
 * 
 * @param {string} ownerId
 * @returns {Promise<object[]>}
 */
export async function getOwnerPaymentHistory(ownerId) {
  const settlements = await prisma.settlement.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      totalEarnings: true,
      totalCommission: true,
      netPayout: true,
      sessionCount: true,
      status: true,
      paidAt: true,
      paymentRef: true,
      paymentMethod: true,
      paymentNotes: true,
      createdAt: true,
    },
  });

  return settlements.map((s) => ({
    ...s,
    totalEarnings: s.totalEarnings.toString(),
    totalCommission: s.totalCommission.toString(),
    netPayout: s.netPayout.toString(),
    type: s.sessionCount === 0 ? "MANUAL" : "BATCH",
  }));
}

export default {
  calculateEarnings,
  recordSessionEarning,
  createSettlement,
  generateBiWeeklySettlements,
  markSettlementAsPaid,
  markSettlementAsFailed,
  getSettlements,
  getSettlementById,
  getPendingSettlementsSummary,
  getOwnerEarningsSummary,
  getOwnerEarningsByStation,
  recordOwnerPayment,
  reverseOwnerPayment,
  deleteSettlement,
  getOwnerPaymentHistory,
};

