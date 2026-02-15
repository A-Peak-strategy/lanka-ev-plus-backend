import prisma from "../config/db.js";
import sessionService from "../services/session.service.js";
import { AuthenticationError } from "../errors/index.js";

/**
 * User Profile Controller
 *
 * Handles user profile management and session history
 */

/**
 * Get authenticated user's profile
 * GET /api/user/me
 */
export async function getProfile(req, res) {
    const user = req.user;

    if (!user) {
        throw new AuthenticationError("User authentication required");
    }

    const profile = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
            id: true,
            firebaseUid: true,
            email: true,
            name: true,
            phone: true,
            role: true,
            isActive: true,
            createdAt: true,
        },
    });

    res.json({
        success: true,
        profile,
    });
}

/**
 * Update authenticated user's profile
 * PUT /api/user/me
 */
export async function updateProfile(req, res) {
    const user = req.user;

    if (!user) {
        throw new AuthenticationError("User authentication required");
    }

    const { name, phone, email } = req.body;

    // Build update data — only include fields that were provided
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
            success: false,
            error: "No fields to update",
        });
    }

    // Check uniqueness constraints
    if (email && email !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(409).json({
                success: false,
                error: "Email is already in use",
            });
        }
    }

    if (phone && phone !== user.phone) {
        const existing = await prisma.user.findUnique({ where: { phone } });
        if (existing) {
            return res.status(409).json({
                success: false,
                error: "Phone number is already in use",
            });
        }
    }

    const updated = await prisma.user.update({
        where: { id: user.id },
        data: updateData,
        select: {
            id: true,
            firebaseUid: true,
            email: true,
            name: true,
            phone: true,
            role: true,
            isActive: true,
            createdAt: true,
        },
    });

    res.json({
        success: true,
        profile: updated,
    });
}

/**
 * Get authenticated user's charging session history
 * GET /api/user/me/sessions
 *
 * Query params: page, limit, startDate, endDate
 */
export async function getSessionHistory(req, res) {
    console.log("GET /api/user/me/sessions called");
    const user = req.user;

    if (!user) {
        throw new AuthenticationError("User authentication required");
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const { startDate, endDate } = req.query;

    // Build where clause
    const where = { userId: user.id };
    if (startDate || endDate) {
        where.startedAt = {};
        if (startDate) where.startedAt.gte = new Date(startDate);
        if (endDate) where.startedAt.lte = new Date(endDate);
    }

    const [sessions, total] = await Promise.all([
        prisma.chargingSession.findMany({
            where,
            include: {
                charger: {
                    include: {
                        station: {
                            select: {
                                name: true,
                                address: true,
                            },
                        },
                    },
                },
            },
            orderBy: { startedAt: "desc" },
            take: limit,
            skip: offset,
        }),
        prisma.chargingSession.count({ where }),
    ]);

    const formatted = sessions.map((s) => ({
        id: s.id,
        transactionId: s.transactionId,
        energyUsedWh: s.energyUsedWh,
        energyUsedKwh: (s.energyUsedWh / 1000).toFixed(2),
        totalCost: s.totalCost?.toString() || "0.00",
        pricePerKwh: s.pricePerKwh?.toString() || "0.00",
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        stopReason: s.stopReason,
        charger: s.charger
            ? {
                id: s.charger.id,
                vendor: s.charger.vendor,
                model: s.charger.model,
                station: s.charger.station
                    ? {
                        name: s.charger.station.name,
                        address: s.charger.station.address,
                    }
                    : null,
            }
            : null,
    }));

    res.json({
        success: true,
        sessions: formatted,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
}

/**
 * Get session statistics for authenticated user
 * GET /api/user/me/sessions/stats
 *
 * Query params: startDate, endDate
 */
export async function getSessionStats(req, res) {
    const user = req.user;

    if (!user) {
        throw new AuthenticationError("User authentication required");
    }

    const { startDate, endDate } = req.query;
    const stats = await sessionService.getUserSessionStats(user.id, {
        startDate,
        endDate,
    });

    res.json({
        success: true,
        stats,
    });
}

export default {
    getProfile,
    updateProfile,
    getSessionHistory,
    getSessionStats,
};
