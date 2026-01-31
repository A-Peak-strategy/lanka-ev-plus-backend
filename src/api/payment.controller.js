import payhereService from "../services/payhere.service.js";
import walletService from "../services/wallet.service.js";
import billingService from "../services/billing.service.js";
import notificationService from "../services/notification.service.js";
import prisma from "../config/db.js";

/**
 * PayHere Webhook Handler
 * 
 * POST /api/payments/webhook
 * 
 * Handles PayHere server-to-server notifications
 */
export async function handlePayHereWebhook(req, res) {
  try {
    // PayHere sends data as URL-encoded form
    // Express automatically parses it, but we need to handle both formats
    const webhookData = req.body;

    // Log webhook for debugging (remove sensitive data in production)
    console.log("[PayHere Webhook] Received:", {
      order_id: webhookData.order_id,
      status_code: webhookData.status_code,
      merchant_id: webhookData.merchant_id,
    });

    // Verify webhook signature
    if (!payhereService.verifyWebhookSignature(webhookData)) {
      console.error("[PayHere Webhook] Invalid signature:", webhookData);
      return res.status(400).json({ 
        success: false,
        error: "Invalid webhook signature" 
      });
    }

    // Process webhook
    const result = await payhereService.processWebhook(webhookData);

    // If payment is successful, update wallet
    if (result.status === "SUCCESS" && result.statusCode === "2") {
      const payment = result.payment;

      // Check if wallet already updated (idempotency)
      const existingLedger = await prisma.ledger.findFirst({
        where: {
          referenceId: payment.orderId,
          referenceType: "PAYMENT",
          type: "TOP_UP",
        },
      });

      if (!existingLedger) {
        // Update user wallet
        const idempotencyKey = `payhere:${payment.orderId}:${payment.payherePaymentId || "unknown"}`;
        
        const walletResult = await walletService.topUp({
          userId: payment.userId,
          amount: payment.payhereAmount || payment.amount,
          paymentId: payment.payherePaymentId || payment.orderId,
          idempotencyKey,
        });

        // Handle wallet top-up during active session
        await billingService.handleWalletTopUpDuringSession(payment.userId);

        // Send notification
        try {
          await notificationService.sendTopUpSuccess({
            userId: payment.userId,
            amount: (payment.payhereAmount || payment.amount).toString(),
            newBalance: walletResult.wallet.balance.toString(),
          });
        } catch (notifError) {
          console.error("Notification error:", notifError);
        }
      }
    }

    // Always return 200 to PayHere (they retry on non-200)
    res.status(200).json({ 
      success: true,
      message: "Webhook processed",
      orderId: webhookData.order_id,
    });
  } catch (error) {
    console.error("[PayHere Webhook] Error:", error);
    
    // Still return 200 to prevent PayHere retries
    // Log error for manual investigation
    res.status(200).json({ 
      success: false,
      error: "Webhook processing failed",
      message: error.message,
    });
  }
}

/**
 * Payment Return Handler (User redirected after payment)
 * 
 * GET /api/payments/return
 */
export async function handlePaymentReturn(req, res) {
  try {
    const { order_id, payment_id, status_code } = req.query;

    if (!order_id) {
      return res.status(400).json({ 
        success: false,
        error: "Order ID is required" 
      });
    }

    // Get payment record
    const payment = await payhereService.getPaymentByOrderId(order_id);

    if (!payment) {
      return res.status(404).json({ 
        success: false,
        error: "Payment not found" 
      });
    }

    // Status code mapping
    const statusMap = {
      "0": "PENDING",
      "1": "PROCESSING",
      "2": "SUCCESS",
      "-1": "CANCELLED",
      "-2": "FAILED",
      "-3": "EXPIRED",
    };

    const status = statusMap[status_code] || "FAILED";

    // Return payment status to frontend
    // In production, redirect to frontend URL with status
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const redirectUrl = `${frontendUrl}/payment/return?orderId=${order_id}&status=${status}&paymentId=${payment_id || ""}`;

    res.redirect(redirectUrl);
  } catch (error) {
    console.error("Payment return error:", error);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(`${frontendUrl}/payment/error`);
  }
}

/**
 * Payment Cancel Handler (User cancelled payment)
 * 
 * GET /api/payments/cancel
 */
export async function handlePaymentCancel(req, res) {
  try {
    const { order_id } = req.query;

    if (order_id) {
      // Update payment status to cancelled
      await prisma.payment.updateMany({
        where: { orderId: order_id },
        data: { status: "CANCELLED" },
      });
    }

    // Redirect to frontend
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(`${frontendUrl}/payment/cancelled`);
  } catch (error) {
    console.error("Payment cancel error:", error);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(`${frontendUrl}/payment/error`);
  }
}

/**
 * Get payment status
 * 
 * GET /api/payments/:orderId
 */
export async function getPaymentStatus(req, res) {
  try {
    const { orderId } = req.params;

    const payment = await payhereService.getPaymentByOrderId(orderId);

    if (!payment) {
      return res.status(404).json({ 
        success: false,
        error: "Payment not found" 
      });
    }

    res.json({
      success: true,
      payment: {
        id: payment.id,
        orderId: payment.orderId,
        amount: payment.amount.toString(),
        currency: payment.currency,
        status: payment.status,
        payherePaymentId: payment.payherePaymentId,
        statusMessage: payment.statusMessage,
        createdAt: payment.createdAt,
        completedAt: payment.completedAt,
      },
    });
  } catch (error) {
    console.error("Get payment status error:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to get payment status" 
    });
  }
}

/**
 * Get user payments
 * 
 * GET /api/payments/user/:userId
 */
export async function getUserPayments(req, res) {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user?.id;
    const { limit = 50, offset = 0, status } = req.query;

    // Check authorization
    if (requestingUserId && requestingUserId !== userId && req.user?.role !== "ADMIN") {
      return res.status(403).json({ 
        success: false,
        error: "Access denied" 
      });
    }

    const payments = await payhereService.getUserPayments(userId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      status,
    });

    res.json({
      success: true,
      payments: payments.map((p) => ({
        id: p.id,
        orderId: p.orderId,
        amount: p.amount.toString(),
        currency: p.currency,
        status: p.status,
        payherePaymentId: p.payherePaymentId,
        createdAt: p.createdAt,
        completedAt: p.completedAt,
      })),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: payments.length === parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get user payments error:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to get payments" 
    });
  }
}

