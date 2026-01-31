import express from "express";
import {
  getWallet,
  topUpWallet,
  getTransactions,
  getWalletByUserId,
  getAllWallets,
  releaseChargingAmount,
} from "./wallet.controller.js";
// import { authMiddleware } from "../middleware/auth.middleware.js";
// import { requireAdmin } from "../middleware/auth.middleware.js";

import { requireActiveUser, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// All wallet routes require authentication
// router.use(authMiddleware);

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

