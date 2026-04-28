import adminService from "../services/admin.service.js";
import settlementService from "../services/settlement.service.js";
import qrCodeService from "../services/qrCode.service.js";
import prisma from "../config/db.js";
import { chargersStore } from "../services/chargerStore.service.js";
import { isChargerOnline } from "../ocpp/ocppServer.js";
import { remoteStopTransaction } from "../ocpp/commands/remoteStopTransaction.js";
import { remoteStartTransaction } from "../ocpp/commands/remoteStartTransaction.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Admin Controller
 * 
 * Handles admin API endpoints for:
 * - User/Owner management
 * - Charger registration
 * - Station management
 * - Pricing configuration
 * - Session monitoring
 * - Settlement management
 * - Audit logs
 */

// ============================================
// USER MANAGEMENT
// ============================================

/**
 * Create a station owner
 * POST /api/admin/owners
 */
export async function createOwner(req, res) {
  try {
    const adminId = req.user?.id || "system"; // Get from auth middleware
    const owner = await adminService.createOwner(req.body, adminId);

    res.status(201).json({
      success: true,
      data: owner,
      message: "Owner created successfully",
    });
  } catch (error) {
    console.error("Create owner error:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * Get all users
 * GET /api/admin/users
 */
export async function getUsers(req, res) {
  try {
    const { role, isActive, limit, offset } = req.query;

    const users = await adminService.getUsers({
      role,
      isActive: isActive === "true" ? true : isActive === "false" ? false : undefined,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });

    res.json({
      success: true,
      data: users,
      count: users.length,
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Update user status
 * PATCH /api/admin/users/:userId/status
 */
export async function updateUserStatus(req, res) {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;
    const adminId = req.user?.id || "system";

    const user = await adminService.updateUserStatus(userId, isActive, adminId);

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Update user role
 * PATCH /api/admin/users/:userId/role
 */
export async function updateUserRole(req, res) {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const adminId = req.user?.id || "system";

    const validRoles = ["CONSUMER", "OWNER", "ADMIN"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role. Must be one of: ${validRoles.join(", ")}`,
      });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
    });

    // Audit log
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action: "UPDATE_USER_ROLE",
        targetType: "USER",
        targetId: userId,
        newValue: { role },
      },
    });

    res.json({
      success: true,
      data: user,
      message: `User role updated to ${role}`,
    });
  } catch (error) {
    console.error("Update user role error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

// ============================================
// CHARGER MANAGEMENT
// ============================================

/**
 * Register a new charger (serial-based)
 * POST /api/admin/chargers
 */
export async function registerCharger(req, res) {
  try {
    const adminId = req.user?.id || "system";
    const charger = await adminService.registerCharger(req.body, adminId);

    res.status(201).json({
      success: true,
      data: charger,
      message: "Charger registered successfully",
    });
  } catch (error) {
    console.error("Register charger error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Get all chargers
 * GET /api/admin/chargers
 */
export async function getChargers(req, res) {
  try {
    const { stationId, status, isRegistered, limit, offset } = req.query;

    const chargers = await adminService.getChargers({
      stationId,
      status,
      isRegistered: isRegistered === "true" ? true : isRegistered === "false" ? false : undefined,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });

    res.json({
      success: true,
      data: chargers,
      count: chargers.length,
    });
  } catch (error) {
    console.error("Get chargers error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get single charger by ID
 * GET /api/admin/chargers/:chargerId
 */
export async function getChargerById(req, res) {
  try {
    const { chargerId } = req.params;
    const charger = await adminService.getChargerById(chargerId);
    res.json({ success: true, data: charger });
  } catch (error) {
    console.error("Get charger by ID error:", error);
    res.status(404).json({ success: false, error: error.message });
  }
}

/**
 * Assign charger to station
 * POST /api/admin/chargers/:chargerId/assign
 */
export async function assignChargerToStation(req, res) {
  try {
    const { chargerId } = req.params;
    const { stationId } = req.body;
    const adminId = req.user?.id || "system";

    const charger = await adminService.assignChargerToStation(chargerId, stationId, adminId);

    res.json({
      success: true,
      data: charger,
      message: "Charger assigned to station",
    });
  } catch (error) {
    console.error("Assign charger error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

// ============================================
// STATION MANAGEMENT
// ============================================

/**
 * Create a station
 * POST /api/admin/stations
 */
export async function createStation(req, res) {
  try {
    const adminId = req.user?.id || "system";
    const station = await adminService.createStation(req.body, adminId);

    res.status(201).json({
      success: true,
      data: station,
      message: "Station created successfully",
    });
  } catch (error) {
    console.error("Create station error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Get all stations
 * GET /api/admin/stations
 */
export async function getStations(req, res) {
  try {
    const { ownerId, isActive, limit, offset } = req.query;

    const stations = await adminService.getStations({
      ownerId,
      isActive: isActive === "true" ? true : isActive === "false" ? false : undefined,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });

    res.json({
      success: true,
      data: stations,
      count: stations.length,
    });
  } catch (error) {
    console.error("Get stations error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Assign station to owner
 * POST /api/admin/stations/:stationId/assign
 */
export async function assignStationToOwner(req, res) {
  try {
    const { stationId } = req.params;
    const { ownerId } = req.body;
    const adminId = req.user?.id || "system";

    const station = await adminService.assignStationToOwner(stationId, ownerId, adminId);

    res.json({
      success: true,
      data: station,
      message: "Station assigned to owner",
    });
  } catch (error) {
    console.error("Assign station error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

// ============================================
// PRICING CONFIGURATION
// ============================================

/**
 * Create pricing configuration
 * POST /api/admin/pricing
 */
export async function createPricing(req, res) {
  try {
    const adminId = req.user?.id || "system";
    const pricing = await adminService.createPricing(req.body, adminId);

    res.status(201).json({
      success: true,
      data: pricing,
      message: "Pricing created successfully",
    });
  } catch (error) {
    console.error("Create pricing error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Update pricing configuration
 * PATCH /api/admin/pricing/:pricingId
 */
export async function updatePricing(req, res) {
  try {
    const { pricingId } = req.params;
    const adminId = req.user?.id || "system";

    const pricing = await adminService.updatePricing(pricingId, req.body, adminId);

    res.json({
      success: true,
      data: pricing,
    });
  } catch (error) {
    console.error("Update pricing error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Get all pricing configurations
 * GET /api/admin/pricing
 */
export async function getPricings(req, res) {
  try {
    const pricings = await adminService.getPricings();

    res.json({
      success: true,
      data: pricings,
    });
  } catch (error) {
    console.error("Get pricings error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Assign pricing to station
 * POST /api/admin/stations/:stationId/pricing
 */
export async function assignPricingToStation(req, res) {
  try {
    const { stationId } = req.params;
    const { pricingId } = req.body;
    const adminId = req.user?.id || "system";

    const station = await adminService.assignPricingToStation(stationId, pricingId, adminId);

    res.json({
      success: true,
      data: station,
      message: "Pricing assigned to station",
    });
  } catch (error) {
    console.error("Assign pricing error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

// ============================================
// SESSION MONITORING
// ============================================

/**
 * Get charging sessions
 * GET /api/admin/sessions
 */
export async function getSessions(req, res) {
  try {
    const { chargerId, userId, stationId, ownerId, startDate, endDate, active, limit, offset } = req.query;

    const sessions = await adminService.getSessions({
      chargerId,
      userId,
      stationId,
      ownerId,
      startDate,
      endDate,
      active: active === "true" ? true : active === "false" ? false : undefined,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });

    res.json({
      success: true,
      data: sessions,
      count: sessions.length,
    });
  } catch (error) {
    console.error("Get sessions error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get session statistics
 * GET /api/admin/sessions/stats
 */
export async function getSessionStats(req, res) {
  try {
    const { startDate, endDate, ownerId, stationId } = req.query;

    const stats = await adminService.getSessionStats({
      startDate,
      endDate,
      ownerId,
      stationId,
    });

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Get session stats error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// ============================================
// OCPP LOGS
// ============================================

/**
 * Get OCPP message logs
 * GET /api/admin/ocpp-logs
 */
export async function getOcppLogs(req, res) {
  try {
    const { chargerId, action, direction, startDate, endDate, limit, offset } = req.query;

    const logs = await adminService.getOcppLogs({
      chargerId,
      action,
      direction,
      startDate,
      endDate,
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0,
    });

    res.json({
      success: true,
      data: logs,
      count: logs.length,
    });
  } catch (error) {
    console.error("Get OCPP logs error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// ============================================
// SETTLEMENTS
// ============================================

/**
 * Get settlements
 * GET /api/admin/settlements
 */
export async function getSettlements(req, res) {
  try {
    const { ownerId, status, startDate, endDate, limit, offset } = req.query;

    const settlements = await settlementService.getSettlements({
      ownerId,
      status,
      startDate,
      endDate,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });

    res.json({
      success: true,
      data: settlements,
      count: settlements.length,
    });
  } catch (error) {
    console.error("Get settlements error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get settlement by ID
 * GET /api/admin/settlements/:settlementId
 */
export async function getSettlementById(req, res) {
  try {
    const { settlementId } = req.params;

    const settlement = await settlementService.getSettlementById(settlementId);

    if (!settlement) {
      return res.status(404).json({
        success: false,
        error: "Settlement not found",
      });
    }

    res.json({
      success: true,
      data: settlement,
    });
  } catch (error) {
    console.error("Get settlement error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Generate bi-weekly settlements
 * POST /api/admin/settlements/generate
 */
export async function generateSettlements(req, res) {
  try {
    const { periodStart, periodEnd } = req.body;

    const result = await settlementService.generateBiWeeklySettlements(periodStart, periodEnd);

    res.status(201).json({
      success: true,
      data: result,
      message: `Generated ${result.settlements.length} settlements`,
    });
  } catch (error) {
    console.error("Generate settlements error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Create settlement for specific owner and period
 * POST /api/admin/settlements
 */
export async function createSettlement(req, res) {
  try {
    const { ownerId, periodStart, periodEnd } = req.body;

    const settlement = await settlementService.createSettlement(
      ownerId,
      new Date(periodStart),
      new Date(periodEnd)
    );

    if (!settlement) {
      return res.status(200).json({
        success: true,
        data: null,
        message: "No sessions to settle for this period",
      });
    }

    res.status(201).json({
      success: true,
      data: settlement,
      message: "Settlement created successfully",
    });
  } catch (error) {
    console.error("Create settlement error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Mark settlement as paid
 * POST /api/admin/settlements/:settlementId/pay
 */
export async function markSettlementPaid(req, res) {
  try {
    const { settlementId } = req.params;
    const { paymentRef, paymentMethod, paymentNotes } = req.body;
    const adminId = req.user?.id || "system";

    if (!paymentRef) {
      return res.status(400).json({
        success: false,
        error: "Payment reference is required",
      });
    }

    const settlement = await settlementService.markSettlementAsPaid(
      settlementId,
      { paymentRef, paymentMethod, paymentNotes },
      adminId
    );

    res.json({
      success: true,
      data: settlement,
      message: "Settlement marked as paid",
    });
  } catch (error) {
    console.error("Mark settlement paid error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Mark settlement as failed
 * POST /api/admin/settlements/:settlementId/fail
 */
export async function markSettlementFailed(req, res) {
  try {
    const { settlementId } = req.params;
    const { reason } = req.body;
    const adminId = req.user?.id || "system";

    const settlement = await settlementService.markSettlementAsFailed(
      settlementId,
      reason || "Payment failed",
      adminId
    );

    res.json({
      success: true,
      data: settlement,
    });
  } catch (error) {
    console.error("Mark settlement failed error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Reverse a manual owner payment
 * POST /api/admin/settlements/:settlementId/reverse
 */
export async function reverseSettlement(req, res) {
  try {
    const { settlementId } = req.params;
    const { reason } = req.body;
    const adminId = req.user?.id || "system";

    if (!reason) {
      return res.status(400).json({ success: false, error: "Reason is required" });
    }

    const settlement = await settlementService.reverseOwnerPayment(
      settlementId,
      reason,
      adminId
    );

    res.json({
      success: true,
      data: settlement,
      message: "Payment reversed successfully",
    });
  } catch (error) {
    console.error("Reverse settlement error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Delete a FAILED settlement
 * DELETE /api/admin/settlements/:settlementId
 */
export async function deleteSettlement(req, res) {
  try {
    const { settlementId } = req.params;
    const adminId = req.user?.id || "system";

    const result = await settlementService.deleteSettlement(settlementId, adminId);

    res.json({
      success: true,
      data: result,
      message: "Settlement deleted successfully",
    });
  } catch (error) {
    console.error("Delete settlement error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Get payment history for an owner
 * GET /api/admin/owners/:ownerId/payment-history
 */
export async function getOwnerPaymentHistory(req, res) {
  try {
    const { ownerId } = req.params;

    const history = await settlementService.getOwnerPaymentHistory(ownerId);

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error("Get payment history error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get pending settlements summary
 * GET /api/admin/settlements/pending-summary
 */
export async function getPendingSettlementsSummary(req, res) {
  try {
    const summary = await settlementService.getPendingSettlementsSummary();

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("Get pending summary error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get owner earnings summary
 * GET /api/admin/owners/:ownerId/earnings
 */
export async function getOwnerEarnings(req, res) {
  try {
    const { ownerId } = req.params;
    const { startDate, endDate } = req.query;

    const earnings = await settlementService.getOwnerEarningsSummary(ownerId, { startDate, endDate });

    res.json({
      success: true,
      data: earnings,
    });
  } catch (error) {
    console.error("Get owner earnings error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get owner earnings broken down by station
 * GET /api/admin/owners/:ownerId/earnings-by-station
 */
export async function getOwnerEarningsByStation(req, res) {
  try {
    const { ownerId } = req.params;
    const { startDate, endDate } = req.query;

    const earnings = await settlementService.getOwnerEarningsByStation(ownerId, { startDate, endDate });

    res.json({
      success: true,
      data: earnings,
    });
  } catch (error) {
    console.error("Get owner earnings by station error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Record a payment to an owner
 * POST /api/admin/owners/:ownerId/payments
 */
export async function recordOwnerPayment(req, res) {
  try {
    const { ownerId } = req.params;
    const adminId = req.user?.id || "system";
    const { amount, paymentRef, paymentMethod, paymentNotes } = req.body;

    const settlement = await settlementService.recordOwnerPayment(
      ownerId,
      { amount, paymentRef, paymentMethod, paymentNotes },
      adminId
    );

    res.json({
      success: true,
      data: settlement,
      message: "Payment recorded successfully",
    });
  } catch (error) {
    console.error("Record owner payment error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

// ============================================
// AUDIT LOGS
// ============================================

/**
 * Get admin audit logs
 * GET /api/admin/audit-logs
 */
export async function getAuditLogs(req, res) {
  try {
    const { adminId, action, targetType, startDate, endDate, limit, offset } = req.query;

    const logs = await adminService.getAuditLogs({
      adminId,
      action,
      targetType,
      startDate,
      endDate,
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0,
    });

    res.json({
      success: true,
      data: logs,
      count: logs.length,
    });
  } catch (error) {
    console.error("Get audit logs error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// ============================================
// DASHBOARD
// ============================================

/**
 * Get dashboard metrics
 * GET /api/admin/dashboard/metrics
 */
export async function getDashboardMetrics(req, res) {
  try {
    const [userCount, chargerCount, activeSessions, totalRevenue] = await Promise.all([
      prisma.user.count({ where: { role: "CONSUMER" } }),
      prisma.charger.count(),
      prisma.chargingSession.count({ where: { endedAt: null } }),
      prisma.chargingSession.aggregate({
        _sum: { totalCost: true },
        where: { endedAt: { not: null } },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers: userCount,
        totalChargers: chargerCount,
        activeSessions,
        totalRevenue: totalRevenue._sum.totalCost?.toString() || "0",
      },
    });
  } catch (error) {
    console.error("Get dashboard metrics error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get single session by ID
 * GET /api/admin/sessions/:sessionId
 */
export async function getSessionById(req, res) {
  try {
    const { sessionId } = req.params;
    const session = await prisma.chargingSession.findUnique({
      where: { id: parseInt(sessionId) },
      include: {
        charger: { include: { station: true } },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    if (!session) {
      return res.status(404).json({ success: false, error: "Session not found" });
    }

    res.json({ success: true, data: session });
  } catch (error) {
    console.error("Get session by ID error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Force stop a charging session
 * POST /api/admin/sessions/:sessionId/force-stop
 */
export async function forceStopSession(req, res) {
  try {
    const { sessionId } = req.params;
    const { reason } = req.body;
    const adminId = req.user?.id || "system";

    const session = await prisma.chargingSession.findUnique({
      where: { id: parseInt(sessionId) },
    });

    if (!session) {
      return res.status(404).json({ success: false, error: "Session not found" });
    }

    if (session.endedAt) {
      return res.status(400).json({ success: false, error: "Session already ended" });
    }

    // Try to send OCPP remote stop
    try {
      await remoteStopTransaction(session.chargerId, session.transactionId);
    } catch (ocppErr) {
      console.warn("OCPP remote stop failed, marking session ended directly:", ocppErr.message);
    }

    // Mark session as ended
    const updated = await prisma.chargingSession.update({
      where: { id: parseInt(sessionId) },
      data: {
        endedAt: new Date(),
        stopReason: reason || "ADMIN_FORCE_STOP",
      },
    });

    // Log admin action
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action: "FORCE_STOP_SESSION",
        targetType: "SESSION",
        targetId: sessionId.toString(),
        newValue: JSON.stringify({ reason }),
      },
    });

    res.json({ success: true, data: updated, message: "Session force stopped" });
  } catch (error) {
    console.error("Force stop session error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get single station by ID
 * GET /api/admin/stations/:stationId
 */
export async function getStationById(req, res) {
  try {
    const { stationId } = req.params;
    const station = await prisma.station.findUnique({
      where: { id: stationId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        pricing: true,
        chargers: { include: { connectors: true } },
      },
    });

    if (!station) {
      return res.status(404).json({ success: false, error: "Station not found" });
    }

    res.json({ success: true, data: station });
  } catch (error) {
    console.error("Get station by ID error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Update station
 * PUT /api/admin/stations/:stationId
 */
export async function updateStation(req, res) {
  try {
    const { stationId } = req.params;
    const adminId = req.user?.id || "system";

    const allowedFields = ["name", "address", "latitude", "longitude", "pricingId", "isActive", "bookingEnabled"];
    const data = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        data[key] = req.body[key];
      }
    }

    const previous = await prisma.station.findUnique({ where: { id: stationId } });
    if (!previous) {
      return res.status(404).json({ success: false, error: "Station not found" });
    }

    const updated = await prisma.station.update({
      where: { id: stationId },
      data,
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action: "UPDATE_STATION",
        targetType: "STATION",
        targetId: stationId,
        previousValue: JSON.stringify(previous),
        newValue: JSON.stringify(data),
      },
    });

    res.json({ success: true, data: updated, message: "Station updated" });
  } catch (error) {
    console.error("Update station error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get single user by ID
 * GET /api/admin/users/:userId
 */
export async function getUserById(req, res) {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error("Get user by ID error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get user's wallet (admin access)
 * GET /api/admin/users/:userId/wallet
 */
export async function getUserWallet(req, res) {
  try {
    const { userId } = req.params;
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      return res.status(404).json({ success: false, error: "Wallet not found" });
    }

    res.json({ success: true, data: wallet });
  } catch (error) {
    console.error("Get user wallet error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}



// ============================================
// QR CODE HANDLERS
// ============================================

/**
 * Generate QR code for a charger
 * POST /api/admin/chargers/:chargerId/generate-qr
 */
export async function generateChargerQR(req, res) {
  try {
    const { chargerId } = req.params;
    const result = await qrCodeService.generateChargerQR(chargerId);
    res.json({
      success: true,
      data: result,
      message: "QR code generated successfully",
    });
  } catch (error) {
    console.error("Generate QR error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Regenerate QR code for a charger
 * POST /api/admin/chargers/:chargerId/regenerate-qr
 */
export async function regenerateChargerQR(req, res) {
  try {
    const { chargerId } = req.params;
    const result = await qrCodeService.regenerateChargerQR(chargerId);
    res.json({
      success: true,
      data: result,
      message: "QR code regenerated successfully",
    });
  } catch (error) {
    console.error("Regenerate QR error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Get QR code info for a charger
 * GET /api/admin/chargers/:chargerId/qr
 */
export async function getChargerQR(req, res) {
  try {
    const { chargerId } = req.params;
    const result = await qrCodeService.getChargerQR(chargerId);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Get QR error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

// ============================================
// DEBUG HANDLERS
// ============================================

/**
 * Admin Remote Start - start charging on a charger
 * POST /api/admin/debug/chargers/:chargerId/start
 */
export async function adminRemoteStart(req, res) {
  try {
    const { chargerId } = req.params;
    const { connectorId } = req.body;
    const cId = parseInt(connectorId) || 1;

    // Verify per-connector state to prevent duplicate start commands
    const memState = chargersStore.get(`${chargerId}:${cId}`);
    if (memState?.status === "Charging" || memState?.status === "Preparing") {
      return res.status(400).json({ success: false, error: `Connector ${cId} is already busy` });
    }

    // Check database for active sessions on this specific connector
    const connectorRecord = await prisma.connector.findUnique({
      where: { chargerId_connectorId: { chargerId, connectorId: cId } },
    });
    if (connectorRecord) {
      const activeSession = await prisma.chargingSession.findFirst({
        where: { chargerId, connectorId: connectorRecord.id, endedAt: null },
      });
      if (activeSession) {
        return res.status(400).json({ success: false, error: `Connector ${cId} already has an active session` });
      }
    }

    const result = await remoteStartTransaction(chargerId, {
      idTag: "ADMIN_DEBUG",
      connectorId: cId,
    });

    res.json({
      success: result.success,
      data: result,
      message: result.success
        ? "Remote start sent successfully"
        : `Remote start failed: ${result.error || result.status}`,
    });
  } catch (error) {
    console.error("Admin remote start error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Admin Remote Stop - stop charging on a charger
 * POST /api/admin/debug/chargers/:chargerId/stop
 */
export async function adminRemoteStop(req, res) {
  try {
    const { chargerId } = req.params;
    const { connectorId } = req.body;

    // Resolve the Connector UUID from the integer OCPP connectorId
    let connectorUuid = null;
    if (connectorId) {
      const connectorRecord = await prisma.connector.findUnique({
        where: { chargerId_connectorId: { chargerId, connectorId: parseInt(connectorId) } },
      });
      if (connectorRecord) connectorUuid = connectorRecord.id;
    }

    // Find the active session on this charger for this connector
    const activeSession = await prisma.chargingSession.findFirst({
      where: {
        chargerId,
        ...(connectorUuid ? { connectorId: connectorUuid } : {}),
        endedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });

    if (!activeSession) {
      return res.status(404).json({
        success: false,
        error: `No active session found on connector ${connectorId || 'any'}`,
      });
    }

    const result = await remoteStopTransaction(
      chargerId,
      activeSession.transactionId || activeSession.id
    );

    res.json({
      success: result.success,
      data: result,
      message: result.success
        ? "Remote stop sent successfully"
        : `Remote stop failed: ${result.error || result.status}`,
    });
  } catch (error) {
    console.error("Admin remote stop error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Get active session for a charger (for debug live view)
 * GET /api/admin/debug/chargers/:chargerId/session
 * 
 * Returns:
 * - activeSession: from DB (chargingSession table)
 * - liveStatus: from in-memory chargerStore (real-time meter data)
 * - liveSession: from chargingSessionLive table (detailed meter readings)
 * - recentSessions: last 10 completed sessions
 */
export async function getActiveSessionForCharger(req, res) {
  try {
    const { chargerId } = req.params;

    // Fetch the charger to know how many connectors it has and get pricing
    const charger = await prisma.charger.findUnique({
      where: { id: chargerId },
      include: { connectors: { orderBy: { connectorId: "asc" } }, station: { include: { pricing: true } } }
    });

    // 1) Active sessions from DB
    const activeSessions = await prisma.chargingSession.findMany({
      where: {
        chargerId,
        endedAt: null,
      },
      include: {
        charger: {
          include: {
            station: { select: { id: true, name: true, pricing: true } },
            connectors: { orderBy: { connectorId: "asc" } },
          },
        },
        connector: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startedAt: "desc" },
    });

    // 2) In-memory charger status (same source the Flutter app polls via /chargers/:id/status)
    const online = isChargerOnline(chargerId);
    const connectorStatuses = [];

    if (charger && charger.connectors) {
      for (const conn of charger.connectors) {
        const memState = chargersStore.get(`${chargerId}:${conn.connectorId}`);
        connectorStatuses.push({
          connectorId: conn.connectorId,
          online,
          status: memState?.status || conn.status || null,
          transactionId: memState?.transactionId ?? memState?.ocppTransactionId ?? null,
          meterWh: memState?.lastMeterValue ?? memState?.lastMeterValueWh ?? null,
          meterStart: memState?.meterStart ?? memState?.meterStartWh ?? null,
          energyUsedWh: (memState?.meterStartWh || memState?.meterStart)
            ? ((memState?.lastMeterValueWh || memState?.lastMeterValue || 0) - (memState?.meterStartWh || memState?.meterStart))
            : null,
          lastHeartbeat: memState?.lastHeartbeat || null,
          lastMeterTime: memState?.lastMeterTime || null,
        });
      }
    }

    // 3) Live session from chargingSessionLive table (detailed meter readings: power, voltage, current, soc)
    for (const session of activeSessions) {
      const liveMeter = await prisma.chargingSessionLive.findUnique({
        where: { sessionId: session.id },
      });
      if (liveMeter) {
        session.liveSession = {
          energyWh: liveMeter.energyWh,
          powerW: liveMeter.powerW,
          voltageV: liveMeter.voltageV,
          currentA: liveMeter.currentA,
          socPercent: liveMeter.socPercent,
          temperatureC: liveMeter.temperatureC,
          lastUpdated: liveMeter.lastMeterAt,
        };
      }
    }

    // 4) Recent completed sessions
    const recentSessions = await prisma.chargingSession.findMany({
      where: {
        chargerId,
        endedAt: { not: null },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        connector: true,
      },
      orderBy: { startedAt: "desc" },
      take: 10,
    });

    // 5) Get pricing for cost calculation
    let energyRatePerKwh = 30; // default fallback
    if (charger?.station?.pricing) {
      const pricing = charger.station.pricing;
      if (pricing.perKwh) energyRatePerKwh = parseFloat(pricing.perKwh);
    }

    res.json({
      success: true,
      data: {
        activeSessions,
        connectorStatuses,
        energyRatePerKwh,
        recentSessions,
      },
    });
  } catch (error) {
    console.error("Get active session error:", error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Admin Set Wallet Balance - directly set a user's wallet balance (debug tool)
 * POST /api/admin/debug/wallet/set-balance
 *
 * Body:
 * - userId: string (required) - Target user ID
 * - newBalance: number (required) - New balance value (>= 0)
 * - reason: string (optional) - Reason for adjustment
 */
export async function adminSetWalletBalance(req, res) {
  try {
    const { userId, newBalance, reason } = req.body;
    const adminId = req.user?.id || "system";

    // Validate inputs
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required" });
    }

    const parsedBalance = parseFloat(newBalance);
    if (isNaN(parsedBalance) || parsedBalance < 0) {
      return res.status(400).json({ success: false, error: "newBalance must be a non-negative number" });
    }

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Find or create wallet
    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    const previousBalance = wallet ? parseFloat(wallet.balance) : 0;

    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId, balance: 0, currency: "LKR" },
      });
    }

    // Update wallet balance and create ledger entry in a transaction
    const [updatedWallet, ledgerEntry] = await prisma.$transaction([
      prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: parsedBalance,
          version: { increment: 1 },
        },
      }),
      prisma.ledger.create({
        data: {
          userId,
          type: "REFUND", // Using REFUND type for admin adjustments
          amount: Math.abs(parsedBalance - previousBalance),
          balanceAfter: parsedBalance,
          referenceId: `ADMIN_DEBUG_${Date.now()}`,
          referenceType: "ADMIN_ADJUSTMENT",
          description: reason || `Admin debug: balance set from ${previousBalance.toFixed(2)} to ${parsedBalance.toFixed(2)}`,
          idempotencyKey: `admin_set_balance_${userId}_${uuidv4()}`,
        },
      }),
    ]);

    // Create audit log
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action: "SET_WALLET_BALANCE",
        targetType: "WALLET",
        targetId: wallet.id,
        previousValue: { balance: previousBalance.toFixed(2) },
        newValue: { balance: parsedBalance.toFixed(2) },
      },
    });

    console.log(`[DEBUG] Admin ${adminId} set wallet balance for user ${userId}: ${previousBalance} → ${parsedBalance}`);

    res.json({
      success: true,
      data: {
        wallet: updatedWallet,
        previousBalance: previousBalance.toFixed(2),
        newBalance: parsedBalance.toFixed(2),
        ledgerEntry,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      },
      message: `Wallet balance updated from ${previousBalance.toFixed(2)} to ${parsedBalance.toFixed(2)} LKR`,
    });
  } catch (error) {
    console.error("Admin set wallet balance error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Delete charger
 */
export async function deleteCharger(req, res) {
  try {
    const { chargerId } = req.params;
    const adminId = req.user?.id || 'system';
    const adminService = await import('../services/admin.service.js');
    const deleted = await adminService.deleteCharger(chargerId, adminId);
    res.json({ success: true, data: deleted, message: 'Charger deleted successfully' });
  } catch (error) {
    console.error('Delete charger error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Update charger
 */
export async function updateCharger(req, res) {
  try {
    const { chargerId } = req.params;
    const adminId = req.user?.id || 'system';
    const data = req.body;
    const adminService = await import('../services/admin.service.js');
    const updated = await adminService.updateCharger(chargerId, data, adminId);
    res.json({ success: true, data: updated, message: 'Charger updated successfully' });
  } catch (error) {
    console.error('Update charger error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Add a connector to a charger
 */
export async function addConnector(req, res) {
  try {
    const { chargerId } = req.params;
    const adminId = req.user?.id || 'system';
    const adminService = await import('../services/admin.service.js');
    const connector = await adminService.addConnector(chargerId, adminId);
    res.json({ success: true, data: connector, message: 'Connector added successfully' });
  } catch (error) {
    console.error('Add connector error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Remove a connector from a charger
 */
export async function removeConnector(req, res) {
  try {
    const { chargerId, connectorId } = req.params;
    const adminId = req.user?.id || 'system';
    const adminService = await import('../services/admin.service.js');
    const connector = await adminService.removeConnector(chargerId, connectorId, adminId);
    res.json({ success: true, data: connector, message: 'Connector removed successfully' });
  } catch (error) {
    console.error('Remove connector error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Delete station
 */
export async function deleteStation(req, res) {
  try {
    const { stationId } = req.params;
    const adminId = req.user?.id || 'system';
    const adminService = await import('../services/admin.service.js');
    const deleted = await adminService.deleteStation(stationId, adminId);
    res.json({ success: true, data: deleted, message: 'Station deleted successfully' });
  } catch (error) {
    console.error('Delete station error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * Unassign charger
 */
export async function unassignCharger(req, res) {
  try {
    const { chargerId } = req.params;
    const adminId = req.user?.id || 'system';
    const adminService = await import('../services/admin.service.js');
    const updated = await adminService.unassignCharger(chargerId, adminId);
    res.json({ success: true, data: updated, message: 'Charger unassigned successfully' });
  } catch (error) {
    console.error('Unassign charger error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
}


/**
 * Delete pricing plan
 * DELETE /api/admin/pricing/:pricingId
 */
export async function deletePricing(req, res) {
  try {
    const { pricingId } = req.params;
    const adminId = req.user?.id || 'system';
    const adminService = await import('../services/admin.service.js');
    const deleted = await adminService.deletePricing(pricingId, adminId);
    res.json({ success: true, data: deleted, message: 'Pricing plan deleted successfully' });
  } catch (error) {
    console.error('Delete pricing error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
}

export default {
  // Users
  createOwner,
  getUsers,
  getUserById,
  getUserWallet,
  updateUserStatus,
  updateUserRole,

  // Chargers
  registerCharger,
  getChargers,
  getChargerById,
  assignChargerToStation,
  deleteCharger,
  updateCharger,
  addConnector,
  removeConnector,
  unassignCharger,

  // Stations
  createStation,
  getStations,
  getStationById,
  updateStation,
  assignStationToOwner,
  deleteStation,

  // Pricing
  createPricing,
  updatePricing,
  getPricings,
  assignPricingToStation,
  deletePricing,

  // Sessions
  getSessions,
  getSessionById,
  getSessionStats,
  forceStopSession,

  // Dashboard
  getDashboardMetrics,

  // OCPP Logs
  getOcppLogs,

  // Settlements
  getSettlements,
  getSettlementById,
  generateSettlements,
  createSettlement,
  markSettlementPaid,
  markSettlementFailed,
  reverseSettlement,
  deleteSettlement,
  getPendingSettlementsSummary,
  getOwnerEarnings,
  getOwnerEarningsByStation,
  recordOwnerPayment,
  getOwnerPaymentHistory,

  // Audit
  getAuditLogs,

  // QR Codes
  generateChargerQR,
  regenerateChargerQR,
  getChargerQR,

  // Debug
  adminRemoteStart,
  adminRemoteStop,
  getActiveSessionForCharger,
  adminSetWalletBalance,
};
