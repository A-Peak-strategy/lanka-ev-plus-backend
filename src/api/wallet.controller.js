import walletService from "../services/wallet.service.js";
import billingService from "../services/billing.service.js";
import notificationService from "../services/notification.service.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Get user's wallet
 * 
 * GET /api/wallet
 */
export async function getWallet(req, res) {
  try {
    // TODO: Get userId from Firebase auth middleware
    const userId = req.user?.id || req.query.userId;

    if (!userId) {
      return res.status(401).json({ error: "User ID required" });
    }

    const wallet = await walletService.getOrCreateWallet(userId);

    res.json({
      success: true,
      wallet: {
        id: wallet.id,
        balance: wallet.balance.toString(),
        currency: wallet.currency,
        updatedAt: wallet.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get wallet error:", error);
    res.status(500).json({ error: "Failed to get wallet" });
  }
}

/**
 * Top up wallet
 * 
 * POST /api/wallet/topup
 * 
 * Body:
 * - amount: number (required)
 * - paymentId: string (required) - Payment gateway reference
 * - idempotencyKey: string (optional) - Unique key for idempotency
 */
export async function topUpWallet(req, res) {
  try {
    // TODO: Get userId from Firebase auth middleware
    const userId = req.user?.id || req.body.userId;
    const { amount, paymentId, idempotencyKey } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User ID required" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Valid amount required" });
    }

    if (!paymentId) {
      return res.status(400).json({ error: "Payment ID required" });
    }

    // Use provided idempotency key or generate one
    const key = idempotencyKey || `topup:${paymentId}:${uuidv4()}`;

    const result = await walletService.topUp({
      userId,
      amount,
      paymentId,
      idempotencyKey: key,
    });

    // Handle wallet top-up during active session (cancels grace period)
    await billingService.handleWalletTopUpDuringSession(userId);

    // Send notification
    await notificationService.sendTopUpSuccess({
      userId,
      amount: amount.toString(),
      newBalance: result.wallet.balance.toString(),
    });

    res.json({
      success: true,
      duplicate: result.duplicate,
      wallet: {
        id: result.wallet.id,
        balance: result.wallet.balance.toString(),
        currency: result.wallet.currency,
      },
      ledgerEntry: {
        id: result.ledgerEntry.id,
        type: result.ledgerEntry.type,
        amount: result.ledgerEntry.amount.toString(),
        createdAt: result.ledgerEntry.createdAt,
      },
    });
  } catch (error) {
    console.error("Top up error:", error);
    res.status(500).json({ error: "Failed to process top-up" });
  }
}

/**
 * Get transaction history
 * 
 * GET /api/wallet/transactions
 * 
 * Query:
 * - limit: number (default 50)
 * - offset: number (default 0)
 * - type: LedgerType (optional filter)
 */
export async function getTransactions(req, res) {
  try {
    // TODO: Get userId from Firebase auth middleware
    const userId = req.user?.id || req.query.userId;
    const { limit = 50, offset = 0, type } = req.query;

    if (!userId) {
      return res.status(401).json({ error: "User ID required" });
    }

    const transactions = await walletService.getTransactionHistory(userId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      type,
    });

    res.json({
      success: true,
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount.toString(),
        balanceAfter: t.balanceAfter.toString(),
        description: t.description,
        referenceId: t.referenceId,
        createdAt: t.createdAt,
      })),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: transactions.length === parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get transactions error:", error);
    res.status(500).json({ error: "Failed to get transactions" });
  }
}

