import express from "express";
import {
  getWallet,
  topUpWallet,
  getTransactions,
} from "./wallet.controller.js";

import { requireActiveUser, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// All wallet routes require authentication
// router.use(authMiddleware);

// GET /api/wallet - Get current wallet balance
router.get("/", verifyToken, requireActiveUser, getWallet);

// POST /api/wallet/topup - Top up wallet
router.post("/topup",verifyToken, requireActiveUser, topUpWallet);

// GET /api/wallet/transactions - Get transaction history
router.get("/transactions",verifyToken, requireActiveUser, getTransactions);

export default router;

