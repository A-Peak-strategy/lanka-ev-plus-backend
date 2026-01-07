import prisma from "../config/db.js";
import Decimal from "decimal.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Ledger Service
 * 
 * IMMUTABLE LEDGER RULES:
 * 1. Never update existing entries
 * 2. Never delete entries
 * 3. Corrections via compensating entries only
 * 4. Every entry must have an idempotency key
 * 5. Running balance tracked in each entry
 */

// Ledger types enum (matches Prisma enum)
export const LedgerType = {
  TOP_UP: "TOP_UP",
  CHARGE_DEBIT: "CHARGE_DEBIT",
  REFUND: "REFUND",
  OWNER_EARNING: "OWNER_EARNING",
  COMMISSION: "COMMISSION",
  SETTLEMENT_PAYOUT: "SETTLEMENT_PAYOUT",
};

// Reference types for traceability
export const ReferenceType = {
  PAYMENT: "PAYMENT",
  CHARGING_SESSION: "CHARGING_SESSION",
  REFUND: "REFUND",
  SETTLEMENT: "SETTLEMENT",
  ADJUSTMENT: "ADJUSTMENT",
};

/**
 * Create a ledger entry with idempotency check
 * 
 * @param {object} params
 * @param {object} tx - Prisma transaction client (optional)
 * @returns {Promise<object>} Created or existing ledger entry
 */
export async function createLedgerEntry(params, tx = prisma) {
  const {
    userId,
    type,
    amount,
    balanceAfter, // Optional - will be calculated if not provided
    referenceId,
    referenceType,
    description,
    idempotencyKey,
    metadata = {},
  } = params;

  // Validate required fields
  if (!userId || !type || amount === undefined) {
    throw new Error("Missing required ledger entry fields");
  }

  if (!idempotencyKey) {
    throw new Error("Idempotency key is required for ledger entries");
  }

  // Check for existing entry (idempotent)
  const existing = await tx.ledger.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    return { entry: existing, duplicate: true };
  }

  // Calculate balanceAfter if not provided
  let finalBalanceAfter = balanceAfter;
  if (balanceAfter === undefined) {
    // Get the last entry for this user to calculate running balance
    const lastEntry = await tx.ledger.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const currentBalance = lastEntry
      ? new Decimal(lastEntry.balanceAfter.toString())
      : new Decimal(0);
    
    const amountDec = new Decimal(amount);
    
    // Debits reduce balance, credits increase
    const isDebit = [LedgerType.CHARGE_DEBIT, LedgerType.COMMISSION, LedgerType.SETTLEMENT_PAYOUT].includes(type);
    finalBalanceAfter = isDebit
      ? currentBalance.minus(amountDec).toFixed(2)
      : currentBalance.plus(amountDec).toFixed(2);
  }

  // Create new entry
  const entry = await tx.ledger.create({
    data: {
      userId,
      type,
      amount: new Decimal(amount).toFixed(2),
      balanceAfter: new Decimal(finalBalanceAfter).toFixed(2),
      referenceId,
      referenceType,
      description,
      idempotencyKey,
      metadata,
    },
  });

  return { entry, duplicate: false };
}

/**
 * Create compensating entry (for corrections)
 * 
 * Instead of modifying an existing entry, we create a new entry
 * that offsets the original one.
 * 
 * @param {object} params
 * @param {string} params.originalEntryId - ID of entry to compensate
 * @param {string} params.reason - Reason for compensation
 * @returns {Promise<object>} Compensating ledger entry
 */
export async function createCompensatingEntry({
  originalEntryId,
  reason,
  idempotencyKey,
}) {
  // Check for duplicate
  const existing = await prisma.ledger.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    return { entry: existing, duplicate: true };
  }

  const originalEntry = await prisma.ledger.findUnique({
    where: { id: originalEntryId },
  });

  if (!originalEntry) {
    throw new Error("Original ledger entry not found");
  }

  // Determine compensating type
  const compensatingType = getCompensatingType(originalEntry.type);
  
  // Get current wallet balance
  const wallet = await prisma.wallet.findUnique({
    where: { userId: originalEntry.userId },
  });

  if (!wallet) {
    throw new Error("Wallet not found for compensation");
  }

  // Calculate new balance after compensation
  const originalAmount = new Decimal(originalEntry.amount.toString());
  const currentBalance = new Decimal(wallet.balance.toString());
  
  // If original was a debit, compensation adds back; if credit, compensation removes
  const isDebit = isDebitType(originalEntry.type);
  const newBalance = isDebit
    ? currentBalance.plus(originalAmount)
    : currentBalance.minus(originalAmount);

  // Execute in transaction
  const result = await prisma.$transaction(async (tx) => {
    // Update wallet
    const updatedWallet = await tx.wallet.update({
      where: {
        userId: originalEntry.userId,
        version: wallet.version,
      },
      data: {
        balance: newBalance.toFixed(2),
        version: { increment: 1 },
      },
    });

    // Create compensating entry
    const compensatingEntry = await tx.ledger.create({
      data: {
        userId: originalEntry.userId,
        type: compensatingType,
        amount: originalAmount.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        referenceId: originalEntryId,
        referenceType: "ADJUSTMENT",
        description: `Compensation for ${originalEntry.type}: ${reason}`,
        idempotencyKey,
        metadata: {
          originalEntryId,
          originalType: originalEntry.type,
          originalAmount: originalAmount.toFixed(2),
          reason,
        },
      },
    });

    return { wallet: updatedWallet, entry: compensatingEntry };
  });

  return { ...result, duplicate: false };
}

/**
 * Record owner earning from a charging session
 * 
 * Adds commission amount to station owner's wallet balance
 * 
 * @param {object} params
 * @returns {Promise<object>} Ledger entry
 */
export async function recordOwnerEarning({
  ownerId,
  amount,
  transactionId,
  sessionId,
  idempotencyKey,
}) {
  // Check for duplicate
  const existing = await prisma.ledger.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    return { entry: existing, duplicate: true };
  }

  const earningAmount = new Decimal(amount);

  // Execute in transaction to update both wallet and ledger
  const result = await prisma.$transaction(async (tx) => {
    // Get or create owner wallet
    let wallet = await tx.wallet.findUnique({
      where: { userId: ownerId },
    });

    if (!wallet) {
      wallet = await tx.wallet.create({
        data: {
          userId: ownerId,
          balance: 0,
          currency: "LKR",
        },
      });
    }

    const currentBalance = new Decimal(wallet.balance.toString());
    const newBalance = currentBalance.plus(earningAmount);

    // Update owner wallet
    const updatedWallet = await tx.wallet.update({
      where: {
        userId: ownerId,
        version: wallet.version,
      },
      data: {
        balance: newBalance.toFixed(2),
        version: { increment: 1 },
      },
    });

    // Create ledger entry
    const entry = await tx.ledger.create({
      data: {
        userId: ownerId,
        type: LedgerType.OWNER_EARNING,
        amount: earningAmount.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        referenceId: transactionId,
        referenceType: ReferenceType.CHARGING_SESSION,
        description: `Earning from session ${sessionId}`,
        idempotencyKey,
        metadata: { sessionId, transactionId },
      },
    });

    return { entry, wallet: updatedWallet };
  });

  return { entry: result.entry, duplicate: false };
}

/**
 * Record commission taken by platform
 * 
 * Deducts commission amount from admin wallet balance
 * 
 * @param {object} params
 * @param {string} params.ownerId - Station owner ID (for reference)
 * @param {string} params.amount - Commission amount
 * @param {string} params.transactionId - Transaction ID
 * @param {number} params.sessionId - Session ID
 * @param {string} params.idempotencyKey - Idempotency key
 * @returns {Promise<object>} Ledger entry
 */
export async function recordCommission({
  ownerId,
  amount,
  transactionId,
  sessionId,
  idempotencyKey,
}) {
  // Check for duplicate
  const existing = await prisma.ledger.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    return { entry: existing, duplicate: true };
  }

  // Get admin user ID
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
  });

  if (!admin) {
    throw new Error("Admin user not found");
  }

  const adminUserId = admin.id;
  const commissionAmount = new Decimal(amount);

  // Execute in transaction to update both wallet and ledger
  const result = await prisma.$transaction(async (tx) => {
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

    const currentBalance = new Decimal(adminWallet.balance.toString());
    
    // Check if admin has sufficient balance (should always have, but safety check)
    if (currentBalance.lt(commissionAmount)) {
      throw new Error(`Insufficient admin balance: ${currentBalance.toFixed(2)} < ${commissionAmount.toFixed(2)}`);
    }

    const newBalance = currentBalance.minus(commissionAmount);

    // Update admin wallet (deduct commission)
    const updatedAdminWallet = await tx.wallet.update({
      where: {
        userId: adminUserId,
        version: adminWallet.version,
      },
      data: {
        balance: newBalance.toFixed(2),
        version: { increment: 1 },
      },
    });

    // Create ledger entry for admin (commission deduction)
    const entry = await tx.ledger.create({
      data: {
        userId: adminUserId,
        type: LedgerType.COMMISSION,
        amount: commissionAmount.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        referenceId: transactionId,
        referenceType: ReferenceType.CHARGING_SESSION,
        description: `Platform commission for session ${sessionId} (owner: ${ownerId})`,
        idempotencyKey,
        metadata: { 
          sessionId, 
          transactionId,
          ownerId,
        },
      },
    });

    return { entry, wallet: updatedAdminWallet };
  });

  return { entry: result.entry, duplicate: false };
}

/**
 * Get ledger entries for a user
 * 
 * @param {string} userId
 * @param {object} options
 * @returns {Promise<object[]>}
 */
export async function getLedgerEntries(userId, options = {}) {
  const {
    limit = 50,
    offset = 0,
    type,
    startDate,
    endDate,
    referenceId,
  } = options;

  const where = { userId };

  if (type) {
    where.type = type;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  if (referenceId) {
    where.referenceId = referenceId;
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
 * Get running balance for a user from ledger
 * (Alternative to wallet table - for reconciliation)
 * 
 * @param {string} userId
 * @returns {Promise<string>} Balance as string
 */
export async function getRunningBalance(userId) {
  const lastEntry = await prisma.ledger.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return lastEntry ? lastEntry.balanceAfter.toString() : "0.00";
}

/**
 * Reconcile wallet balance with ledger
 * 
 * @param {string} userId
 * @returns {Promise<object>} Reconciliation result
 */
export async function reconcileBalance(userId) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
  });

  const ledgerBalance = await getRunningBalance(userId);

  const walletBalance = wallet ? wallet.balance.toString() : "0.00";
  const discrepancy = new Decimal(walletBalance)
    .minus(new Decimal(ledgerBalance))
    .toFixed(2);

  return {
    userId,
    walletBalance,
    ledgerBalance,
    discrepancy,
    isReconciled: discrepancy === "0.00",
  };
}

/**
 * Generate idempotency key for common operations
 */
export function generateIdempotencyKey(prefix, ...parts) {
  return `${prefix}:${parts.join(":")}`;
}

// Helper functions
function isDebitType(type) {
  return [LedgerType.CHARGE_DEBIT, LedgerType.COMMISSION].includes(type);
}

function getCompensatingType(type) {
  // Compensating type is typically REFUND for debits, CHARGE_DEBIT for credits
  if (isDebitType(type)) {
    return LedgerType.REFUND;
  }
  return LedgerType.CHARGE_DEBIT;
}

export default {
  LedgerType,
  ReferenceType,
  createLedgerEntry,
  createCompensatingEntry,
  recordOwnerEarning,
  recordCommission,
  getLedgerEntries,
  getRunningBalance,
  reconcileBalance,
  generateIdempotencyKey,
};

