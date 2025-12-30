import express from "express";
import adminController from "./admin.controller.js";
// import { requireAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

// Note: All routes should have requireAdmin middleware for production
// For development, middleware is commented out

// ============================================
// USER MANAGEMENT
// ============================================

// Create owner
router.post("/admin/owners", /* requireAdmin, */ adminController.createOwner);

// Get all users
router.get("/admin/users", /* requireAdmin, */ adminController.getUsers);

// Update user status
router.patch("/admin/users/:userId/status", /* requireAdmin, */ adminController.updateUserStatus);

// Get owner earnings
router.get("/admin/owners/:ownerId/earnings", /* requireAdmin, */ adminController.getOwnerEarnings);

// ============================================
// CHARGER MANAGEMENT
// ============================================

// Register charger (serial-based)
router.post("/admin/chargers", /* requireAdmin, */ adminController.registerCharger);

// Get all chargers
router.get("/admin/chargers", /* requireAdmin, */ adminController.getChargers);

// Assign charger to station
router.post("/admin/chargers/:chargerId/assign", /* requireAdmin, */ adminController.assignChargerToStation);

// ============================================
// STATION MANAGEMENT
// ============================================

// Create station
router.post("/admin/stations", /* requireAdmin, */ adminController.createStation);

// Get all stations
router.get("/admin/stations", /* requireAdmin, */ adminController.getStations);

// Assign station to owner
router.post("/admin/stations/:stationId/assign", /* requireAdmin, */ adminController.assignStationToOwner);

// Assign pricing to station
router.post("/admin/stations/:stationId/pricing", /* requireAdmin, */ adminController.assignPricingToStation);

// ============================================
// PRICING CONFIGURATION
// ============================================

// Create pricing
router.post("/admin/pricing", /* requireAdmin, */ adminController.createPricing);

// Get all pricings
router.get("/admin/pricing", /* requireAdmin, */ adminController.getPricings);

// Update pricing
router.patch("/admin/pricing/:pricingId", /* requireAdmin, */ adminController.updatePricing);

// ============================================
// SESSION MONITORING
// ============================================

// Get sessions
router.get("/admin/sessions", /* requireAdmin, */ adminController.getSessions);

// Get session statistics
router.get("/admin/sessions/stats", /* requireAdmin, */ adminController.getSessionStats);

// ============================================
// OCPP LOGS
// ============================================

// Get OCPP message logs
router.get("/admin/ocpp-logs", /* requireAdmin, */ adminController.getOcppLogs);

// ============================================
// SETTLEMENTS
// ============================================

// Get pending settlements summary (must be before /:settlementId)
router.get("/admin/settlements/pending-summary", /* requireAdmin, */ adminController.getPendingSettlementsSummary);

// Generate bi-weekly settlements
router.post("/admin/settlements/generate", /* requireAdmin, */ adminController.generateSettlements);

// Get all settlements
router.get("/admin/settlements", /* requireAdmin, */ adminController.getSettlements);

// Create settlement for specific owner/period
router.post("/admin/settlements", /* requireAdmin, */ adminController.createSettlement);

// Get settlement by ID
router.get("/admin/settlements/:settlementId", /* requireAdmin, */ adminController.getSettlementById);

// Mark settlement as paid
router.post("/admin/settlements/:settlementId/pay", /* requireAdmin, */ adminController.markSettlementPaid);

// Mark settlement as failed
router.post("/admin/settlements/:settlementId/fail", /* requireAdmin, */ adminController.markSettlementFailed);

// ============================================
// AUDIT LOGS
// ============================================

// Get audit logs
router.get("/admin/audit-logs", /* requireAdmin, */ adminController.getAuditLogs);

export default router;

