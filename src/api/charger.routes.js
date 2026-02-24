import express from "express";
import {
  getAllChargers,
  getCharger,
  lookupChargerByCode,
  getChargerStatus,
  getChargerSessions,
  startCharging,
  stopCharging,
  getLiveSession
} from "./charger.controller.js";
import { verifyToken, requireActiveUser, optionalAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

// GET /api/chargers - Get all chargers (public, optional auth for personalization)
router.get("/", optionalAuth, getAllChargers);

// GET /api/chargers/lookup?code=123456 - Lookup charger by backup code or QR data (requires auth)
router.get("/lookup", verifyToken, requireActiveUser, lookupChargerByCode);

// GET /api/chargers/:chargerId - Get single charger (public)
router.get("/:chargerId", optionalAuth, getCharger);

// GET /api/chargers/:chargerId/status - Get charger status (public)
router.get("/:chargerId/status", getChargerStatus);

// GET /api/chargers/:chargerId/sessions - Get charger sessions (requires auth)
router.get("/:chargerId/sessions", verifyToken, requireActiveUser, getChargerSessions);

// POST /api/chargers/:chargerId/start - Start charging (requires auth)
router.post("/:chargerId/start", verifyToken, requireActiveUser, startCharging);

// POST /api/chargers/:chargerId/stop - Stop charging (requires auth)
router.post("/:chargerId/stop", verifyToken, requireActiveUser, stopCharging);

router.get("/sessions/:transactionId/live", getLiveSession);

export default router;
