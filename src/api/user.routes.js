import { Router } from "express";
import {
    getProfile,
    updateProfile,
    getSessionHistory,
    getSessionStats,
} from "./user.controller.js";
import {
    verifyToken,
    requireActiveUser,
} from "../middleware/auth.middleware.js";

const router = Router();

// All user routes require authentication
router.use(verifyToken, requireActiveUser);

// GET /api/user/me - Get user profile
router.get("/me", getProfile);

// PUT /api/user/me - Update user profile
router.put("/me", updateProfile);

// GET /api/user/me/sessions - Get charging session history
router.get("/me/sessions", getSessionHistory);

// GET /api/user/me/sessions/stats - Get session statistics
router.get("/me/sessions/stats", getSessionStats);

export default router;
