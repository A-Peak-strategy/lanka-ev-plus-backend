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
 * Get admin user ID
 * @returns {Promise<string>} Admin user ID
 */
async function getAdminUserId() {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
  });

  if (!admin) {
    throw new Error("Admin user not found");
  }

  return admin.id;
}

/**
 * Top up wallet (add funds)
 * 
 * When user completes payment:
 * - Add payment amount to user's wallet balance
 * - Add payment amount to admin's wallet balance
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

  // Get admin user ID
  const adminUserId = await getAdminUserId();

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

    // Update user wallet with version check (optimistic locking)
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

    // Create ledger entry for user
    const ledgerEntry = await tx.ledger.create({
      data: {
        userId,
        type: LedgerType.TOP_UP,
        amount: amountDecimal.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        referenceId: String(paymentId),
        referenceType: "PAYMENT",
        description: `Wallet top-up via payment ${paymentId}`,
        idempotencyKey,
        metadata: { paymentId, amount: amountDecimal.toFixed(2) },
      },
    });

    // Get or create admin wallet
    let adminWallet = await tx.wallet.findUnique({
      where: { userId: adminUserId },
    });

    if (!adminWallet) {
      adminWallet = await tx.wallet.create({
        data: {
          userId: adminUserId,
          balance: 0,
          currency: "LKR",
        },
      });
    }

    // Add same amount to admin wallet
    const adminCurrentBalance = new Decimal(adminWallet.balance.toString());
    const adminNewBalance = adminCurrentBalance.plus(amountDecimal);

    const updatedAdminWallet = await tx.wallet.update({
      where: {
        userId: adminUserId,
        version: adminWallet.version,
      },
      data: {
        balance: adminNewBalance.toFixed(2),
        version: { increment: 1 },
      },
    });

    // Create ledger entry for admin
    const adminIdempotencyKey = `${idempotencyKey}:admin`;
    await tx.ledger.create({
      data: {
        userId: adminUserId,
        type: LedgerType.TOP_UP,
        amount: amountDecimal.toFixed(2),
        balanceAfter: adminNewBalance.toFixed(2),
        referenceId: String(paymentId),
        referenceType: "PAYMENT",
        description: `Payment received from user ${userId} via payment ${paymentId}`,
        idempotencyKey: adminIdempotencyKey,
        metadata: {
          paymentId,
          amount: amountDecimal.toFixed(2),
          sourceUserId: userId,
        },
      },
    });

    return { wallet: updatedWallet, ledgerEntry, adminWallet: updatedAdminWallet };
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
  chargerId,
  pricePerKwh,
}) {
  const amountDecimal = new Decimal(amount);

  if (amountDecimal.lte(0)) {
    return { success: true, skipped: true, reason: "Zero amount" };
  }

  // NOTE: No ledger entry during charging.
  // Consolidated ledger entry is created at session end in finalizeSessionBilling().
  // Duplicate billing is already prevented by lastBilledWh in billing.service.js.

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

        // Update wallet with optimistic lock (no ledger entry — that comes at session end)
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

        return {
          success: true,
          wallet: updatedWallet,
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

/**
 * Release charging amount - distribute payment after charging
 * 
 * This function:
 * 1. Checks if user has sufficient balance
 * 2. Deducts amount from user wallet
 * 3. Calculates commission and owner earning
 * 4. Adds commission to admin wallet
 * 5. Adds owner earning to station owner wallet
 * 
 * @param {object} params
 * @param {string} params.userId - User ID who charged
 * @param {string} params.ownerId - Station owner ID
 * @param {number|string} params.amount - Total charging amount
 * @param {number|string} params.commissionRate - Commission rate percentage (e.g., 2.00 for 2%)
 * @param {string} params.transactionId - Charging session transaction ID
 * @param {string} params.idempotencyKey - Unique key for idempotency
 * @returns {Promise<object>} Result with all wallet updates
 */
export async function releaseChargingAmount({
  userId,
  ownerId,
  amount,
  commissionRate,
  transactionId,
  idempotencyKey,
}) {
  // Validate inputs
  if (!userId) {
    throw new ValidationError("User ID is required", "userId");
  }
  if (!ownerId) {
    throw new ValidationError("Owner ID is required", "ownerId");
  }
  if (!amount || new Decimal(amount).lte(0)) {
    throw new ValidationError("Valid amount is required", "amount");
  }
  if (!idempotencyKey) {
    throw new ValidationError("Idempotency key is required", "idempotencyKey");
  }

  const amountDecimal = new Decimal(amount);
  const commissionRateDecimal = new Decimal(commissionRate || 2.0);

  // Check for duplicate using idempotency key
  const existingEntry = await prisma.ledger.findUnique({
    where: { idempotencyKey },
  });

  if (existingEntry) {
    // Return existing result (idempotent)
    const userWallet = await getOrCreateWallet(userId);
    return {
      success: true,
      duplicate: true,
      userWallet,
      ledgerEntry: existingEntry,
    };
  }

  // Calculate commission and owner earning
  const commission = amountDecimal.times(commissionRateDecimal.dividedBy(100));
  const ownerEarning = amountDecimal.minus(commission);

  // Check if user has sufficient balance
  const balanceCheck = await checkSufficientBalance(userId, amountDecimal.toFixed(2));
  if (!balanceCheck.sufficient) {
    const required = new Decimal(balanceCheck.requiredAmount);
    const available = new Decimal(balanceCheck.currentBalance);
    throw new InsufficientBalanceError(required, available);
  }

  // Get admin user ID
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
  });

  if (!admin) {
    throw new Error("Admin user not found");
  }

  const adminUserId = admin.id;

  // Execute in transaction
  const result = await prisma.$transaction(async (tx) => {
    // 1. Deduct from user wallet
    const userWallet = await tx.wallet.findUnique({
      where: { userId },
    });

    if (!userWallet) {
      throw new WalletNotFoundError(`Wallet not found for user ${userId}`);
    }

    const userCurrentBalance = new Decimal(userWallet.balance.toString());

    if (userCurrentBalance.lt(amountDecimal)) {
      throw new InsufficientBalanceError(amountDecimal, userCurrentBalance);
    }

    const userNewBalance = userCurrentBalance.minus(amountDecimal);

    const updatedUserWallet = await tx.wallet.update({
      where: {
        userId,
        version: userWallet.version,
      },
      data: {
        balance: userNewBalance.toFixed(2),
        version: { increment: 1 },
      },
    });

    // Create ledger entry for user deduction
    const userLedgerEntry = await tx.ledger.create({
      data: {
        userId,
        type: LedgerType.CHARGE_DEBIT,
        amount: amountDecimal.toFixed(2),
        balanceAfter: userNewBalance.toFixed(2),
        referenceId: String(transactionId),
        referenceType: "CHARGING_SESSION",
        description: `Charging payment release for transaction ${transactionId}`,
        idempotencyKey,
        metadata: {
          transactionId,
          amount: amountDecimal.toFixed(2),
          commission: commission.toFixed(2),
          ownerEarning: ownerEarning.toFixed(2),
        },
      },
    });

    // 2. Add commission to admin wallet
    let adminWallet = await tx.wallet.findUnique({
      where: { userId: adminUserId },
    });

    if (!adminWallet) {
      adminWallet = await tx.wallet.create({
        data: {
          userId: adminUserId,
          balance: 0,
          currency: "LKR",
        },
      });
    }

    const adminCurrentBalance = new Decimal(adminWallet.balance.toString());
    const adminNewBalance = adminCurrentBalance.plus(commission);

    const updatedAdminWallet = await tx.wallet.update({
      where: {
        userId: adminUserId,
        version: adminWallet.version,
      },
      data: {
        balance: adminNewBalance.toFixed(2),
        version: { increment: 1 },
      },
    });

    // Create ledger entry for admin commission
    const adminIdempotencyKey = `${idempotencyKey}:admin`;
    await tx.ledger.create({
      data: {
        userId: adminUserId,
        type: LedgerType.COMMISSION,
        amount: commission.toFixed(2),
        balanceAfter: adminNewBalance.toFixed(2),
        referenceId: String(transactionId),
        referenceType: "CHARGING_SESSION",
        description: `Commission from charging transaction ${transactionId}`,
        idempotencyKey: adminIdempotencyKey,
        metadata: {
          transactionId,
          commission: commission.toFixed(2),
          totalAmount: amountDecimal.toFixed(2),
          commissionRate: commissionRateDecimal.toFixed(2),
          ownerId,
        },
      },
    });

    // 3. Add owner earning to station owner wallet
    let ownerWallet = await tx.wallet.findUnique({
      where: { userId: ownerId },
    });

    if (!ownerWallet) {
      ownerWallet = await tx.wallet.create({
        data: {
          userId: ownerId,
          balance: 0,
          currency: "LKR",
        },
      });
    }

    const ownerCurrentBalance = new Decimal(ownerWallet.balance.toString());
    const ownerNewBalance = ownerCurrentBalance.plus(ownerEarning);

    const updatedOwnerWallet = await tx.wallet.update({
      where: {
        userId: ownerId,
        version: ownerWallet.version,
      },
      data: {
        balance: ownerNewBalance.toFixed(2),
        version: { increment: 1 },
      },
    });

    // Create ledger entry for owner earning
    const ownerIdempotencyKey = `${idempotencyKey}:owner`;
    await tx.ledger.create({
      data: {
        userId: ownerId,
        type: LedgerType.OWNER_EARNING,
        amount: ownerEarning.toFixed(2),
        balanceAfter: ownerNewBalance.toFixed(2),
        referenceId: String(transactionId),
        referenceType: "CHARGING_SESSION",
        description: `Earning from charging transaction ${transactionId}`,
        idempotencyKey: ownerIdempotencyKey,
        metadata: {
          transactionId,
          ownerEarning: ownerEarning.toFixed(2),
          totalAmount: amountDecimal.toFixed(2),
          commission: commission.toFixed(2),
          commissionRate: commissionRateDecimal.toFixed(2),
        },
      },
    });

    return {
      success: true,
      userWallet: updatedUserWallet,
      adminWallet: updatedAdminWallet,
      ownerWallet: updatedOwnerWallet,
      ledgerEntry: userLedgerEntry,
      amounts: {
        total: amountDecimal.toFixed(2),
        commission: commission.toFixed(2),
        ownerEarning: ownerEarning.toFixed(2),
        commissionRate: commissionRateDecimal.toFixed(2),
      },
    };
  });

  return { ...result, duplicate: false };
}

/**
 * Lock funds in wallet for a charging session (reserve)
 * 
 * @param {string} userId
 * @param {number|string} amount - Amount to lock
 * @returns {Promise<object>} Updated wallet
 */
export async function lockFunds(userId, amount) {
  const amountDecimal = new Decimal(amount);

  if (amountDecimal.lte(0)) {
    throw new ValidationError("Lock amount must be positive");
  }

  const MAX_RETRIES = 3;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    attempts++;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });

        if (!wallet) {
          throw new WalletNotFoundError(userId);
        }

        const balance = new Decimal(wallet.balance.toString());
        const currentLocked = new Decimal(wallet.lockedBalance.toString());
        const available = balance.minus(currentLocked);

        if (available.lt(amountDecimal)) {
          throw new InsufficientBalanceError(
            available.toFixed(2),
            amountDecimal.toFixed(2)
          );
        }

        const newLocked = currentLocked.plus(amountDecimal);

        const updatedWallet = await tx.wallet.update({
          where: { userId, version: wallet.version },
          data: {
            lockedBalance: newLocked.toFixed(2),
            version: { increment: 1 },
          },
        });

        return {
          success: true,
          wallet: updatedWallet,
          lockedAmount: amountDecimal.toFixed(2),
          availableBalance: balance.minus(newLocked).toFixed(2),
        };
      });

      return result;
    } catch (error) {
      if (
        error.code === "P2025" ||
        error.message?.includes("Record to update not found")
      ) {
        if (attempts >= MAX_RETRIES) throw new ConcurrentModificationError();
        await new Promise((r) => setTimeout(r, Math.pow(2, attempts) * 10));
        continue;
      }
      throw error;
    }
  }

  throw new ConcurrentModificationError();
}

/**
 * Unlock funds from wallet (release reservation)
 * 
 * @param {string} userId
 * @param {number|string} amount - Amount to unlock
 * @returns {Promise<object>} Updated wallet
 */
export async function unlockFunds(userId, amount) {
  const amountDecimal = new Decimal(amount);

  if (amountDecimal.lte(0)) {
    return { success: true, skipped: true };
  }

  const MAX_RETRIES = 3;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    attempts++;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });

        if (!wallet) {
          throw new WalletNotFoundError(userId);
        }

        const currentLocked = new Decimal(wallet.lockedBalance.toString());
        // Don't go below 0
        const newLocked = Decimal.max(currentLocked.minus(amountDecimal), new Decimal(0));

        const updatedWallet = await tx.wallet.update({
          where: { userId, version: wallet.version },
          data: {
            lockedBalance: newLocked.toFixed(2),
            version: { increment: 1 },
          },
        });

        return {
          success: true,
          wallet: updatedWallet,
          unlockedAmount: amountDecimal.toFixed(2),
        };
      });

      return result;
    } catch (error) {
      if (
        error.code === "P2025" ||
        error.message?.includes("Record to update not found")
      ) {
        if (attempts >= MAX_RETRIES) throw new ConcurrentModificationError();
        await new Promise((r) => setTimeout(r, Math.pow(2, attempts) * 10));
        continue;
      }
      throw error;
    }
  }

  throw new ConcurrentModificationError();
}

/**
 * Get available balance (balance - lockedBalance)
 * 
 * @param {string} userId
 * @returns {Promise<string>} Available balance as string
 */
export async function getAvailableBalance(userId) {
  const wallet = await getOrCreateWallet(userId);
  const balance = new Decimal(wallet.balance.toString());
  const locked = new Decimal(wallet.lockedBalance.toString());
  return balance.minus(locked).toFixed(2);
}

export default {
  getOrCreateWallet,
  getBalance,
  topUp,
  deductForCharging,
  checkSufficientBalance,
  processRefund,
  getTransactionHistory,
  releaseChargingAmount,
  lockFunds,
  unlockFunds,
  getAvailableBalance,
};

