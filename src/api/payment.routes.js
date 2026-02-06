import express from "express";
import {
  handlePayHereWebhook,
  handlePaymentReturn,
  handlePaymentCancel,
  getPaymentStatus,
  getUserPayments,
} from "./payment.controller.js";
import { verifyToken, requireActiveUser } from "../middleware/auth.middleware.js";

const router = express.Router();

// Webhook endpoint - no auth required (PayHere calls this server-to-server)
// Signature is verified inside the handler
router.post("/webhook", handlePayHereWebhook);

// Return and cancel endpoints - no auth required (browser redirects from PayHere)
router.get("/return", handlePaymentReturn);
router.get("/cancel", handlePaymentCancel);

// Payment status endpoints - require auth
router.get("/:orderId", verifyToken, requireActiveUser, getPaymentStatus);
router.get("/user/:userId", verifyToken, requireActiveUser, getUserPayments);

export default router;





