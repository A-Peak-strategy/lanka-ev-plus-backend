import admin from "../config/firebase.js";
import prisma from "../config/db.js";
import crypto from "crypto";


/**
 * Authentication Middleware
 * 
 * Verifies Firebase ID tokens and attaches user to request
 */

/**
 * Verify Firebase ID token
 */
export async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid authorization header",
      });
    }

    const token = authHeader.split("Bearer ")[1];

    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Get or create user in database
    let user = await prisma.user.findUnique({
      where: { firebaseUid: decodedToken.uid },
    });

    if (!user) {
      // Create new user with CONSUMER role
      user = await prisma.user.create({
        data: {
          firebaseUid: decodedToken.uid,
          email: decodedToken.email,
          phone: decodedToken.phone_number,
          name: decodedToken.name,
          role: "CONSUMER",
          ocppIdTag: makeOcppIdTag(),
        },
      });

      // Create wallet for new user
      await prisma.wallet.create({
        data: {
          userId: user.id,
          balance: 0,
          currency: "LKR",
        },
      });
    }

    // Attach user to request
    req.user = user;
    req.firebaseUser = decodedToken;

    next();
  } catch (error) {
    console.error("Token verification error:", error);

    if (error.code === "auth/id-token-expired") {
      return res.status(401).json({
        success: false,
        error: "Token expired",
      });
    }

    return res.status(401).json({
      success: false,
      error: "Invalid token",
    });
  }
}

/**
 * Generate unique OCPP ID tag for user
 */
function makeOcppIdTag() {
  // 12 chars, safe
  return "U" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

/**
 * Optional authentication - doesn't fail if no token
 */
export async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split("Bearer ")[1];

    const decodedToken = await admin.auth().verifyIdToken(token);

    const user = await prisma.user.findUnique({
      where: { firebaseUid: decodedToken.uid },
    });

    if (user) {
      req.user = user;
      req.firebaseUser = decodedToken;
    }

    next();
  } catch (error) {
    // Silently fail - optional auth
    next();
  }
}

/**
 * Require ADMIN role
 */
export async function requireAdmin(req, res, next) {
  // First verify token
  await verifyToken(req, res, async () => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    if (req.user.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        error: "Admin access required",
      });
    }

    next();
  });
}

/**
 * Require OWNER or ADMIN role
 */
export async function requireOwnerOrAdmin(req, res, next) {
  await verifyToken(req, res, async () => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    if (!["OWNER", "ADMIN"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: "Owner or admin access required",
      });
    }

    next();
  });
}

/**
 * Check if user is active
 */
export function requireActiveUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "Authentication required",
    });
  }

  if (!req.user.isActive) {
    return res.status(403).json({
      success: false,
      error: "Account is deactivated",
    });
  }

  next();
}

/**
 * Check if user owns the resource (by userId param)
 */
export function requireOwnership(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "Authentication required",
    });
  }

  const { userId } = req.params;

  // Admin can access anything
  if (req.user.role === "ADMIN") {
    return next();
  }

  // User can only access their own resources
  if (userId !== req.user.id) {
    return res.status(403).json({
      success: false,
      error: "Access denied",
    });
  }

  next();
}

export default {
  verifyToken,
  optionalAuth,
  requireAdmin,
  requireOwnerOrAdmin,
  requireActiveUser,
  requireOwnership,
};

