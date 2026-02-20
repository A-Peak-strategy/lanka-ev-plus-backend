import express from "express";
import adminController from "./admin.controller.js";
import { requireAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

// All admin routes require ADMIN role authentication

// ============================================
// DASHBOARD
// ============================================

// Get dashboard metrics
router.get("/admin/dashboard/metrics", requireAdmin, adminController.getDashboardMetrics);

// ============================================
// USER MANAGEMENT
// ============================================

// Create owner
router.post("/admin/owners", requireAdmin, adminController.createOwner);

// Get owner earnings
router.get("/admin/owners/:ownerId/earnings", requireAdmin, adminController.getOwnerEarnings);

// Get owner earnings by station
router.get("/admin/owners/:ownerId/earnings-by-station", requireAdmin, adminController.getOwnerEarningsByStation);

// Record payment to owner
router.post("/admin/owners/:ownerId/payments", requireAdmin, adminController.recordOwnerPayment);

// Get all users
router.get("/admin/users", requireAdmin, adminController.getUsers);

// Get single user by ID
router.get("/admin/users/:userId", requireAdmin, adminController.getUserById);

// Get user's wallet
router.get("/admin/users/:userId/wallet", requireAdmin, adminController.getUserWallet);

// Update user status
router.patch("/admin/users/:userId/status", requireAdmin, adminController.updateUserStatus);

// ============================================
// CHARGER MANAGEMENT
// ============================================

// Register charger (serial-based)
router.post("/admin/chargers", requireAdmin, adminController.registerCharger);

// Get all chargers
router.get("/admin/chargers", requireAdmin, adminController.getChargers);

// Get single charger by ID
router.get("/admin/chargers/:chargerId", requireAdmin, adminController.getChargerById);

// Assign charger to station
router.post("/admin/chargers/:chargerId/assign", requireAdmin, adminController.assignChargerToStation);

// QR Code management
router.post("/admin/chargers/:chargerId/generate-qr", requireAdmin, adminController.generateChargerQR);
router.post("/admin/chargers/:chargerId/regenerate-qr", requireAdmin, adminController.regenerateChargerQR);
router.get("/admin/chargers/:chargerId/qr", requireAdmin, adminController.getChargerQR);

// ============================================
// STATION MANAGEMENT
// ============================================

// Create station
router.post("/admin/stations", requireAdmin, adminController.createStation);

// Get all stations
router.get("/admin/stations", requireAdmin, adminController.getStations);

// Get single station by ID
router.get("/admin/stations/:stationId", requireAdmin, adminController.getStationById);

// Update station
router.put("/admin/stations/:stationId", requireAdmin, adminController.updateStation);

// Assign station to owner
router.post("/admin/stations/:stationId/assign", requireAdmin, adminController.assignStationToOwner);

// Assign pricing to station
router.post("/admin/stations/:stationId/pricing", requireAdmin, adminController.assignPricingToStation);

// ============================================
// PRICING CONFIGURATION
// ============================================

// Create pricing
router.post("/admin/pricing", requireAdmin, adminController.createPricing);

// Get all pricings
router.get("/admin/pricing", requireAdmin, adminController.getPricings);

// Update pricing
router.patch("/admin/pricing/:pricingId", requireAdmin, adminController.updatePricing);

// ============================================
// SESSION MONITORING
// ============================================

// Get session statistics (must be before /:sessionId)
router.get("/admin/sessions/stats", requireAdmin, adminController.getSessionStats);

// Get sessions
router.get("/admin/sessions", requireAdmin, adminController.getSessions);

// Get single session by ID
router.get("/admin/sessions/:sessionId", requireAdmin, adminController.getSessionById);

// Force stop a session
router.post("/admin/sessions/:sessionId/force-stop", requireAdmin, adminController.forceStopSession);

// ============================================
// OCPP LOGS
// ============================================

// Get OCPP message logs
router.get("/admin/ocpp-logs", requireAdmin, adminController.getOcppLogs);

// ============================================
// SETTLEMENTS
// ============================================

// Get pending settlements summary (must be before /:settlementId)
router.get("/admin/settlements/pending-summary", requireAdmin, adminController.getPendingSettlementsSummary);

// Generate bi-weekly settlements
router.post("/admin/settlements/generate", requireAdmin, adminController.generateSettlements);

// Get all settlements
router.get("/admin/settlements", requireAdmin, adminController.getSettlements);

// Create settlement for specific owner/period
router.post("/admin/settlements", requireAdmin, adminController.createSettlement);

// Get settlement by ID
router.get("/admin/settlements/:settlementId", requireAdmin, adminController.getSettlementById);

// Mark settlement as paid
router.post("/admin/settlements/:settlementId/pay", requireAdmin, adminController.markSettlementPaid);

// Mark settlement as failed
router.post("/admin/settlements/:settlementId/fail", requireAdmin, adminController.markSettlementFailed);

// ============================================
// AUDIT LOGS
// ============================================

// Get audit logs
router.get("/admin/audit-logs", requireAdmin, adminController.getAuditLogs);

// ============================================
// DEBUG
// ============================================

// Remote start charging (admin debug)
router.post("/admin/debug/chargers/:chargerId/start", requireAdmin, adminController.adminRemoteStart);

// Remote stop charging (admin debug)
router.post("/admin/debug/chargers/:chargerId/stop", requireAdmin, adminController.adminRemoteStop);

// Get active session for charger (debug live view)
router.get("/admin/debug/chargers/:chargerId/session", requireAdmin, adminController.getActiveSessionForCharger);

// Set wallet balance (admin debug)
router.post("/admin/debug/wallet/set-balance", requireAdmin, adminController.adminSetWalletBalance);

export default router;
