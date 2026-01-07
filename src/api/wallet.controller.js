import walletService from "../services/wallet.service.js";
import billingService from "../services/billing.service.js";
import notificationService from "../services/notification.service.js";
import payhereService from "../services/payhere.service.js";
import { v4 as uuidv4 } from "uuid";
import prisma from "../config/db.js";

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
 * Top up wallet - Initiate PayHere payment
 * 
 * POST /api/wallet/topup
 * 
 * Body:
 * - amount: number (required) - Top-up amount
 * - email: string (required) - User email
 * - phone: string (required) - User phone
 * - firstName: string (optional) - User first name
 * - lastName: string (optional) - User last name
 * - address: string (optional) - User address
 * - city: string (optional) - User city
 * - country: string (optional) - User country (default: Sri Lanka)
 */
export async function topUpWallet(req, res) {
  try {
    // TODO: Get userId from Firebase auth middleware
    const userId = req.user?.id || req.body.userId;
    const { 
      amount, 
      email, 
      phone, 
      firstName, 
      lastName, 
      address, 
      city, 
      country 
    } = req.body;

    // Validation
    if (!userId) {
      return res.status(401).json({ 
        success: false,
        error: "User ID required" 
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false,
        error: "Valid amount is required (must be greater than 0)" 
      });
    }

    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: "Email is required" 
      });
    }

    if (!phone) {
      return res.status(400).json({ 
        success: false,
        error: "Phone number is required" 
      });
    }

    // Get user details if not provided
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
      },
    });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: "User not found" 
      });
    }

    // Use user data as fallback
    const finalEmail = email || user.email;
    const finalPhone = phone || user.phone;
    const nameParts = (firstName || lastName || user.name || "").split(" ");
    const finalFirstName = firstName || nameParts[0] || "";
    const finalLastName = lastName || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

    // Initiate PayHere payment
    const paymentResult = await payhereService.initiatePayment({
      userId,
      amount,
      email: finalEmail,
      phone: finalPhone,
      firstName: finalFirstName,
      lastName: finalLastName,
      address: address || null,
      city: city || null,
      country: country || "Sri Lanka",
    });

    res.json({
      success: true,
      message: "Payment initiated successfully",
      payment: {
        id: paymentResult.payment.id,
        orderId: paymentResult.payment.orderId,
        amount: paymentResult.payment.amount.toString(),
        currency: paymentResult.payment.currency,
        status: paymentResult.payment.status,
        createdAt: paymentResult.payment.createdAt,
      },
      checkout: {
        url: paymentResult.checkoutUrl,
        method: "POST",
        data: paymentResult.checkoutData,
      },
    });
  } catch (error) {
    console.error("Top up error:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to initiate payment",
      message: error.message 
    });
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

/**
 * Get wallet details by userId
 * 
 * GET /api/wallet/:userId
 * 
 * Admin only or own wallet
 */
export async function getWalletByUserId(req, res) {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user?.id;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Check if user is requesting their own wallet or is admin
    if (requestingUserId && requestingUserId !== userId && req.user?.role !== "ADMIN") {
      return res.status(403).json({ error: "Access denied" });
    }

    const wallet = await walletService.getOrCreateWallet(userId);

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    res.json({
      success: true,
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        balance: wallet.balance.toString(),
        currency: wallet.currency,
        updatedAt: wallet.updatedAt,
        user: user || null,
      },
    });
  } catch (error) {
    console.error("Get wallet by userId error:", error);
    res.status(500).json({ error: "Failed to get wallet" });
  }
}

/**
 * Get all wallet details
 * 
 * GET /api/wallet/all
 * 
 * Admin only
 */
export async function getAllWallets(req, res) {
  try {
    // Check if user is admin
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { limit = 100, offset = 0, role } = req.query;

    const where = {};
    if (role) {
      where.user = { role };
    }

    const wallets = await prisma.wallet.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: parseInt(limit),
      skip: parseInt(offset),
    });

    const total = await prisma.wallet.count({ where });

    res.json({
      success: true,
      wallets: wallets.map((w) => ({
        id: w.id,
        userId: w.userId,
        balance: w.balance.toString(),
        currency: w.currency,
        updatedAt: w.updatedAt,
        user: w.user,
      })),
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + wallets.length < total,
      },
    });
  } catch (error) {
    console.error("Get all wallets error:", error);
    res.status(500).json({ error: "Failed to get wallets" });
  }
}

/**
 * Release charging amount
 * 
 * POST /api/wallet/release-charging
 * 
 * This API:
 * 1. Checks if user has sufficient balance
 * 2. Deducts amount from user wallet
 * 3. Adds commission to admin wallet
 * 4. Adds owner earning to station owner wallet
 * 
 * Body:
 * - userId: string (required) - User ID who charged
 * - ownerId: string (required) - Station owner ID
 * - amount: number (required) - Total charging amount
 * - commissionRate: number (optional, default: 2.0) - Commission rate percentage
 * - transactionId: string (required) - Charging session transaction ID
 * - idempotencyKey: string (optional) - Unique key for idempotency
 */
export async function releaseChargingAmount(req, res) {
  try {
    const { userId, ownerId, amount, commissionRate, transactionId, idempotencyKey } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json({ 
        success: false,
        error: "User ID is required",
        field: "userId"
      });
    }

    if (!ownerId) {
      return res.status(400).json({ 
        success: false,
        error: "Owner ID is required",
        field: "ownerId"
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false,
        error: "Valid amount is required (must be greater than 0)",
        field: "amount"
      });
    }

    if (!transactionId) {
      return res.status(400).json({ 
        success: false,
        error: "Transaction ID is required",
        field: "transactionId"
      });
    }

    // Generate idempotency key if not provided
    const key = idempotencyKey || `release:${transactionId}:${uuidv4()}`;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: "User not found",
        userId
      });
    }

    // Check if owner exists
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
    });

    if (!owner) {
      return res.status(404).json({ 
        success: false,
        error: "Station owner not found",
        ownerId
      });
    }

    if (owner.role !== "OWNER") {
      return res.status(400).json({ 
        success: false,
        error: "Provided owner ID is not a station owner",
        ownerId,
        ownerRole: owner.role
      });
    }

    // Call service to release charging amount
    const result = await walletService.releaseChargingAmount({
      userId,
      ownerId,
      amount,
      commissionRate: commissionRate || 2.0,
      transactionId,
      idempotencyKey: key,
    });

    res.json({
      success: true,
      duplicate: result.duplicate || false,
      message: "Charging amount released successfully",
      amounts: result.amounts,
      wallets: {
        user: {
          id: result.userWallet.id,
          userId: result.userWallet.userId,
          balance: result.userWallet.balance.toString(),
          previousBalance: (parseFloat(result.userWallet.balance.toString()) + parseFloat(result.amounts.total)).toFixed(2),
        },
        admin: {
          id: result.adminWallet.id,
          userId: result.adminWallet.userId,
          balance: result.adminWallet.balance.toString(),
          commissionAdded: result.amounts.commission,
        },
        owner: {
          id: result.ownerWallet.id,
          userId: result.ownerWallet.userId,
          balance: result.ownerWallet.balance.toString(),
          earningAdded: result.amounts.ownerEarning,
        },
      },
      transactionId,
    });
  } catch (error) {
    console.error("Release charging amount error:", error);

    // Handle specific error types
    if (error.name === "InsufficientBalanceError" || error.message?.includes("Insufficient")) {
      return res.status(400).json({
        success: false,
        error: error.message || "Insufficient wallet balance",
        code: "INSUFFICIENT_BALANCE",
        details: error.currentBalance ? {
          currentBalance: error.currentBalance,
          requiredAmount: error.requiredAmount,
        } : undefined,
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        error: error.message,
        code: "VALIDATION_ERROR",
        field: error.field,
      });
    }

    if (error.name === "WalletNotFoundError") {
      return res.status(404).json({
        success: false,
        error: error.message || "Wallet not found",
        code: "WALLET_NOT_FOUND",
      });
    }

    // Generic error
    res.status(500).json({
      success: false,
      error: "Failed to release charging amount",
      message: error.message,
    });
  }
}

