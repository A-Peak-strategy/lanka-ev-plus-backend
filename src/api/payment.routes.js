import express from "express";
import {
  handlePayHereWebhook,
  handlePaymentReturn,
  handlePaymentCancel,
  getPaymentStatus,
  getUserPayments,
} from "./payment.controller.js";
// import { verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// Webhook endpoint - no auth required (PayHere calls this)
// But we verify signature in the handler
router.post("/webhook", handlePayHereWebhook);

// Return and cancel endpoints - no auth required (redirects from PayHere)
router.get("/return", handlePaymentReturn);
router.get("/cancel", handlePaymentCancel);

// Payment status endpoints - require auth
// router.use(verifyToken);
router.get("/:orderId", getPaymentStatus);
router.get("/user/:userId", getUserPayments);

export default router;





