import express from "express";
import {
  getAllChargers,
  getCharger,
  getChargerStatus,
  getChargerSessions,
  startCharging,
  stopCharging,
  unlockConnector
} from "./charger.controller.js";

const router = express.Router();

// GET /api/chargers - Get all chargers
router.get("/", getAllChargers);

// GET /api/chargers/:chargerId - Get single charger
router.get("/:chargerId", getCharger);

// GET /api/chargers/:chargerId/status - Get charger status
router.get("/:chargerId/status", getChargerStatus);

// GET /api/chargers/:chargerId/sessions - Get charger sessions
router.get("/:chargerId/sessions", getChargerSessions);

// POST /api/chargers/:chargerId/start - Start charging
router.post("/:chargerId/start", startCharging);

// POST /api/chargers/:chargerId/stop - Stop charging
router.post("/:chargerId/stop", stopCharging);

router.post("/:chargerId/unlock", unlockConnector );

export default router;
