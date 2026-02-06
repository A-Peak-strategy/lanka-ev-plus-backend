import express from "express";
import {
  getWallet,
  topUpWallet,
  getTransactions,
  getWalletByUserId,
  getAllWallets,
  releaseChargingAmount,
} from "./wallet.controller.js";
import { requireActiveUser, verifyToken } from "../middleware/auth.middleware.js";
import { getAuth } from "../config/firebase.js";
import prisma from "../config/db.js";

const router = express.Router();

// Auth middleware - verifies Firebase token when Admin SDK is configured,
// falls back to JWT decode for development when it's not.
router.use(async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(); // Let controller handle missing user
    }

    const token = authHeader.split("Bearer ")[1];
    const auth = getAuth();

    if (auth) {
      // Firebase Admin is configured - verify token properly
      const decodedToken = await auth.verifyIdToken(token);
      let user = await prisma.user.findUnique({
        where: { firebaseUid: decodedToken.uid },
      });
      if (!user) {
        user = await prisma.user.create({
          data: {
            firebaseUid: decodedToken.uid,
            email: decodedToken.email,
            phone: decodedToken.phone_number,
            name: decodedToken.name,
            role: "CONSUMER",
          },
        });
        await prisma.wallet.create({
          data: { userId: user.id, balance: 0, currency: "LKR" },
        });
      }
      req.user = user;
    } else {
      // Firebase Admin NOT configured - decode JWT payload (dev only)
      console.warn("⚠️ Firebase Admin not configured - using JWT decode fallback (dev only)");
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString()
      );
      const firebaseUid = payload.sub || payload.user_id;
      if (firebaseUid) {
        let user = await prisma.user.findUnique({
          where: { firebaseUid },
        });
        if (!user) {
          user = await prisma.user.create({
            data: {
              firebaseUid,
              email: payload.email,
              name: payload.name,
              role: "CONSUMER",
            },
          });
          await prisma.wallet.create({
            data: { userId: user.id, balance: 0, currency: "LKR" },
          });
        }
        req.user = user;
      }
    }
    next();
  } catch (error) {
    console.error("Wallet auth error:", error.message);
    next(); // Don't block - let controller handle missing user
  }
});

// GET /api/wallet - Get current wallet balance
router.get("/", verifyToken, requireActiveUser, getWallet);

// POST /api/wallet/topup - Top up wallet
router.post("/topup",verifyToken, requireActiveUser, topUpWallet);

// POST /api/wallet/release-charging - Release charging amount
router.post("/release-charging", releaseChargingAmount);

// GET /api/wallet/transactions - Get transaction history
router.get("/transactions",verifyToken, requireActiveUser, getTransactions);

// GET /api/wallet/all - Get all wallets (admin only)
// router.get("/all", requireAdmin, getAllWallets);
router.get("/all", getAllWallets);

// GET /api/wallet/:userId - Get wallet by userId (must be last to avoid route conflicts)
router.get("/:userId", getWalletByUserId);

export default router;
