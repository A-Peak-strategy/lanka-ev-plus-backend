import { Router } from "express";
import {
    getProfile,
    updateProfile,
    getSessionHistory,
    getSessionStats,
    getActiveSessions,
    deleteAccount,
    createMembershipRequest,
    getMyMembershipRequests,
    getMyMemberships,
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

// DELETE /api/user/me - Delete user account (soft-delete)
router.delete("/me", deleteAccount);

// Station membership requests and currently active/expired memberships
router.post("/me/membership-requests", createMembershipRequest);
router.get("/me/membership-requests", getMyMembershipRequests);
router.get("/me/memberships", getMyMemberships);

// GET /api/user/me/sessions - Get charging session history
router.get("/me/sessions", getSessionHistory);

// GET /api/user/me/sessions/active - Get active charging sessions (for app restore)
router.get("/me/sessions/active", getActiveSessions);

// GET /api/user/me/sessions/stats - Get session statistics
router.get("/me/sessions/stats", getSessionStats);

export default router;
