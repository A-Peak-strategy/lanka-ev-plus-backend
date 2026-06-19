import express from "express";
import {
    getAppConfig,
    updateAppConfig,
} from "./appConfig.controller.js";
import { requireAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", getAppConfig);

// Protect this route with admin middleware
router.put("/edit", requireAdmin, updateAppConfig);

export default router;