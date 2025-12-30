import adminService from "../services/admin.service.js";
import settlementService from "../services/settlement.service.js";

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
    const result = await settlementService.generateBiWeeklySettlements();
    
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
    
    const earnings = await settlementService.getOwnerEarningsSummary(ownerId);
    
    res.json({
      success: true,
      data: earnings,
    });
  } catch (error) {
    console.error("Get owner earnings error:", error);
    res.status(500).json({ success: false, error: error.message });
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

export default {
  // Users
  createOwner,
  getUsers,
  updateUserStatus,
  
  // Chargers
  registerCharger,
  getChargers,
  assignChargerToStation,
  
  // Stations
  createStation,
  getStations,
  assignStationToOwner,
  
  // Pricing
  createPricing,
  updatePricing,
  getPricings,
  assignPricingToStation,
  
  // Sessions
  getSessions,
  getSessionStats,
  
  // OCPP Logs
  getOcppLogs,
  
  // Settlements
  getSettlements,
  getSettlementById,
  generateSettlements,
  createSettlement,
  markSettlementPaid,
  markSettlementFailed,
  getPendingSettlementsSummary,
  getOwnerEarnings,
  
  // Audit
  getAuditLogs,
};

