import express from "express";
import {
  getWallet,
  topUpWallet,
  getTransactions,
} from "./wallet.controller.js";
// import { authMiddleware } from "../middleware/auth.middleware.js";

const router = express.Router();

// All wallet routes require authentication
// router.use(authMiddleware);

// GET /api/wallet - Get current wallet balance
router.get("/", getWallet);

// POST /api/wallet/topup - Top up wallet
router.post("/topup", topUpWallet);

// GET /api/wallet/transactions - Get transaction history
router.get("/transactions", getTransactions);

export default router;

