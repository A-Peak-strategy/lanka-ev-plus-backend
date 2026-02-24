import express from "express";
import { getConnectorStatus } from "./connector.controller.js";

const router = express.Router();

// GET /api/chargers/:chargerId/connectors/:connectorId/status
router.get(
  "/chargers/:chargerId/connectors/:connectorId/status",
  getConnectorStatus
);

export default router;
