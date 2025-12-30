import prisma from "../config/db.js";
import Decimal from "decimal.js";
import { createLedgerEntry, LedgerType } from "./ledger.service.js";
import {
  WalletNotFoundError,
  InsufficientBalanceError,
  ConcurrentModificationError,
  ValidationError,
} from "../errors/index.js";

// Configure Decimal.js for financial precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/**
 * Wallet Service
 * 
 * Handles all wallet operations with:
 * - Optimistic locking for concurrency safety
 * - No negative balance (prepaid only)
 * - Atomic operations with ledger entries
 */

/**
 * Get or create wallet for a user
 * @param {string} userId
 * @returns {Promise<object>} Wallet object
 */
export async function getOrCreateWallet(userId) {
  let wallet = await prisma.wallet.findUnique({
    where: { userId },
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        userId,
        balance: 0,
        currency: "LKR",
      },
    });
  }

  return wallet;
}

/**
 * Get wallet balance
 * @param {string} userId
 * @returns {Promise<Decimal>} Current balance
 */
export async function getBalance(userId) {
  const wallet = await getOrCreateWallet(userId);
  return new Decimal(wallet.balance.toString());
}

/**
 * Top up wallet (add funds)
 * 
 * @param {object} params
 * @param {string} params.userId - User ID
 * @param {number|string} params.amount - Amount to add
 * @param {string} params.paymentId - Payment gateway reference
 * @param {string} params.idempotencyKey - Unique key to prevent duplicates
 * @returns {Promise<object>} Updated wallet and ledger entry
 */
export async function topUp({ userId, amount, paymentId, idempotencyKey }) {
  // Validate inputs
  if (!userId) {
    throw new ValidationError("User ID is required", "userId");
  }
  if (!idempotencyKey) {
    throw new ValidationError("Idempotency key is required", "idempotencyKey");
  }

  const amountDecimal = new Decimal(amount);

  if (amountDecimal.lte(0)) {
    throw new ValidationError("Top-up amount must be positive", "amount");
  }

  // Check for duplicate using idempotency key
  const existingEntry = await prisma.ledger.findUnique({
    where: { idempotencyKey },
  });

  if (existingEntry) {
    // Return existing result (idempotent)
    const wallet = await getOrCreateWallet(userId);
    return { wallet, ledgerEntry: existingEntry, duplicate: true };
  }

  // Execute in transaction with optimistic locking
  const result = await prisma.$transaction(async (tx) => {
    // Get current wallet with lock
    const wallet = await tx.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const currentBalance = new Decimal(wallet.balance.toString());
    const newBalance = currentBalance.plus(amountDecimal);

    // Update wallet with version check (optimistic locking)
    const updatedWallet = await tx.wallet.update({
      where: {
        userId,
        version: wallet.version, // Optimistic lock
      },
      data: {
        balance: newBalance.toFixed(2),
        version: { increment: 1 },
      },
    });

    // Create ledger entry
    const ledgerEntry = await tx.ledger.create({
      data: {
        userId,
        type: LedgerType.TOP_UP,
        amount: amountDecimal.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        referenceId: paymentId,
        referenceType: "PAYMENT",
        description: `Wallet top-up via payment ${paymentId}`,
        idempotencyKey,
        metadata: { paymentId, amount: amountDecimal.toFixed(2) },
      },
    });

    return { wallet: updatedWallet, ledgerEntry };
  });

  return { ...result, duplicate: false };
}

/**
 * Deduct from wallet for charging
 * 
 * Uses optimistic locking to handle concurrent MeterValues
 * 
 * @param {object} params
 * @param {string} params.userId - User ID
 * @param {number|string} params.amount - Amount to deduct
 * @param {string} params.transactionId - Charging session transaction ID
 * @param {string} params.idempotencyKey - Unique key (e.g., transactionId-meterWh)
 * @param {number} params.energyWh - Energy consumed in Wh
 * @returns {Promise<object>} Result with wallet, ledgerEntry, and status
 */
export async function deductForCharging({
  userId,
  amount,
  transactionId,
  idempotencyKey,
  energyWh,
}) {
  const amountDecimal = new Decimal(amount);

  if (amountDecimal.lte(0)) {
    return { success: true, skipped: true, reason: "Zero amount" };
  }

  // Check for duplicate
  const existingEntry = await prisma.ledger.findUnique({
    where: { idempotencyKey },
  });

  if (existingEntry) {
    const wallet = await getOrCreateWallet(userId);
    return {
      success: true,
      duplicate: true,
      wallet,
      ledgerEntry: existingEntry,
    };
  }

  // Retry loop for optimistic locking
  const MAX_RETRIES = 3;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    attempts++;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId },
        });

        if (!wallet) {
          throw new Error("Wallet not found");
        }

        const currentBalance = new Decimal(wallet.balance.toString());

        // Check if sufficient balance
        if (currentBalance.lt(amountDecimal)) {
          // Cannot deduct - insufficient funds
          return {
            success: false,
            insufficientFunds: true,
            currentBalance: currentBalance.toFixed(2),
            requiredAmount: amountDecimal.toFixed(2),
            shortfall: amountDecimal.minus(currentBalance).toFixed(2),
          };
        }

        const newBalance = currentBalance.minus(amountDecimal);

        // Update wallet with optimistic lock
        const updatedWallet = await tx.wallet.update({
          where: {
            userId,
            version: wallet.version,
          },
          data: {
            balance: newBalance.toFixed(2),
            version: { increment: 1 },
          },
        });

        // Create ledger entry
        const ledgerEntry = await tx.ledger.create({
          data: {
            userId,
            type: LedgerType.CHARGE_DEBIT,
            amount: amountDecimal.toFixed(2),
            balanceAfter: newBalance.toFixed(2),
            referenceId: transactionId,
            referenceType: "CHARGING_SESSION",
            description: `Charging debit for ${energyWh}Wh`,
            idempotencyKey,
            metadata: {
              transactionId,
              energyWh,
              amount: amountDecimal.toFixed(2),
            },
          },
        });

        return {
          success: true,
          wallet: updatedWallet,
          ledgerEntry,
          newBalance: newBalance.toFixed(2),
        };
      });

      return result;
    } catch (error) {
      // Check if it's an optimistic lock failure
      if (
        error.code === "P2025" ||
        error.message.includes("Record to update not found")
      ) {
        if (attempts >= MAX_RETRIES) {
          throw new ConcurrentModificationError();
        }
        // Retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 10));
        continue;
      }
      throw error;
    }
  }

  throw new ConcurrentModificationError();
}

/**
 * Check if user has sufficient balance for an amount
 * @param {string} userId
 * @param {number|string} amount
 * @returns {Promise<object>} Balance check result
 */
export async function checkSufficientBalance(userId, amount) {
  const balance = await getBalance(userId);
  const amountDecimal = new Decimal(amount);

  return {
    sufficient: balance.gte(amountDecimal),
    currentBalance: balance.toFixed(2),
    requiredAmount: amountDecimal.toFixed(2),
    shortfall: balance.lt(amountDecimal)
      ? amountDecimal.minus(balance).toFixed(2)
      : "0.00",
  };
}

/**
 * Process refund to wallet
 * 
 * @param {object} params
 * @param {string} params.userId - User ID
 * @param {number|string} params.amount - Amount to refund
 * @param {string} params.reason - Refund reason
 * @param {string} params.referenceId - Original transaction reference
 * @param {string} params.idempotencyKey - Unique key
 * @returns {Promise<object>} Updated wallet and ledger entry
 */
export async function processRefund({
  userId,
  amount,
  reason,
  referenceId,
  idempotencyKey,
}) {
  const amountDecimal = new Decimal(amount);

  if (amountDecimal.lte(0)) {
    throw new Error("Refund amount must be positive");
  }

  // Check for duplicate
  const existingEntry = await prisma.ledger.findUnique({
    where: { idempotencyKey },
  });

  if (existingEntry) {
    const wallet = await getOrCreateWallet(userId);
    return { wallet, ledgerEntry: existingEntry, duplicate: true };
  }

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const currentBalance = new Decimal(wallet.balance.toString());
    const newBalance = currentBalance.plus(amountDecimal);

    const updatedWallet = await tx.wallet.update({
      where: {
        userId,
        version: wallet.version,
      },
      data: {
        balance: newBalance.toFixed(2),
        version: { increment: 1 },
      },
    });

    const ledgerEntry = await tx.ledger.create({
      data: {
        userId,
        type: LedgerType.REFUND,
        amount: amountDecimal.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        referenceId,
        referenceType: "REFUND",
        description: reason,
        idempotencyKey,
        metadata: { reason, originalReference: referenceId },
      },
    });

    return { wallet: updatedWallet, ledgerEntry };
  });

  return { ...result, duplicate: false };
}

/**
 * Get wallet transaction history
 * @param {string} userId
 * @param {object} options
 * @returns {Promise<object[]>} Ledger entries
 */
export async function getTransactionHistory(userId, options = {}) {
  const { limit = 50, offset = 0, type } = options;

  const where = { userId };
  if (type) {
    where.type = type;
  }

  const entries = await prisma.ledger.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });

  return entries;
}

export default {
  getOrCreateWallet,
  getBalance,
  topUp,
  deductForCharging,
  checkSufficientBalance,
  processRefund,
  getTransactionHistory,
};

