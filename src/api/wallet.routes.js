import express from "express";
import {
  getWallet,
  topUpWallet,
  getTransactions,
  getWalletByUserId,
  getAllWallets,
  releaseChargingAmount,
} from "./wallet.controller.js";
import { requireActiveUser, requireAdmin, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// GET /api/wallet - Get current wallet balance
router.get("/", verifyToken, requireActiveUser, getWallet);

// POST /api/wallet/topup - Top up wallet
router.post("/topup", verifyToken, requireActiveUser, topUpWallet);

// POST /api/wallet/release-charging - Release charging amount (internal use, requires auth)
router.post("/release-charging", verifyToken, requireActiveUser, releaseChargingAmount);

// GET /api/wallet/transactions - Get transaction history
router.get("/transactions", verifyToken, requireActiveUser, getTransactions);

// GET /api/wallet/all - Get all wallets (admin only)
router.get("/all", requireAdmin, getAllWallets);

// GET /api/wallet/:userId - Get wallet by userId (admin only, must be last to avoid route conflicts)
router.get("/:userId", requireAdmin, getWalletByUserId);

export default router;
