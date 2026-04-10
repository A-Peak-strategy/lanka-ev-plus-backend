import crypto from "crypto";
import prisma from "../config/db.js";
import Decimal from "decimal.js";
import { v4 as uuidv4 } from "uuid";

/**
 * PayHere Payment Gateway Service
 * 
 * Handles PayHere payment gateway integration with:
 * - Payment initiation
 * - Webhook verification
 * - Signature validation
 * - Idempotency handling
 */

const notifyUrl =
  process.env.NOTIFY_URL ||
  (process.env.APP_URL && `${process.env.APP_URL}/api/payments/webhook`) ||
  "https://app-api.lankaevplus.com/api/payments/webhook";

// PayHere configuration
const PAYHERE_CONFIG = {
  merchantId: process.env.PAYHERE_MERCHANT_ID,
  merchantSecret: process.env.PAYHERE_MERCHANT_SECRET,
  sandbox: process.env.PAYHERE_SANDBOX === "true" || !process.env.PAYHERE_MERCHANT_ID,
  baseUrl: process.env.PAYHERE_SANDBOX === "true"
    ? "https://sandbox.payhere.lk"
    : "https://www.payhere.lk",
  returnUrl: process.env.PAYHERE_RETURN_URL || `${process.env.APP_URL || "http://localhost:3000"}/api/payments/return`,
  cancelUrl: process.env.PAYHERE_CANCEL_URL || `${process.env.APP_URL || "http://localhost:3000"}/api/payments/cancel`,
  // notifyUrl: process.env.NOTIFY_URL || `${process.env.APP_URL || "http://localhost:8000"}/api/payments/webhook`,
  notifyUrl: notifyUrl,
};

/**
 * Generate MD5 hash for PayHere signature
 * 
 * @param {object} params - Parameters to hash
 * @returns {string} MD5 hash in uppercase
 */
function generateHash(params) {
  const {
    merchantId,
    orderId,
    amount,
    currency,
    statusCode = null,
  } = params;

  if (!PAYHERE_CONFIG.merchantSecret) {
    throw new Error("PayHere merchant secret not configured");
  }

  // Hash the merchant secret first
  const hashedSecret = crypto
    .createHash("md5")
    .update(PAYHERE_CONFIG.merchantSecret)
    .digest("hex")
    .toUpperCase();

  // Build hash string
  let hashString = merchantId + orderId;

  if (amount !== undefined) {
    hashString += parseFloat(amount).toFixed(2);
  }

  if (currency) {
    hashString += currency;
  }

  if (statusCode !== null) {
    hashString += statusCode;
  }

  hashString += hashedSecret;

  // Generate final hash
  const hash = crypto.createHash("md5").update(hashString).digest("hex").toUpperCase();

  return hash;
}

/**
 * Verify PayHere webhook signature
 * 
 * @param {object} webhookData - Webhook payload from PayHere
 * @returns {boolean} True if signature is valid
 */
export function verifyWebhookSignature(webhookData) {
  const {
    merchant_id,
    order_id,
    payhere_amount,
    payhere_currency,
    status_code,
    md5sig,
  } = webhookData;

  // console.log("webhookData", webhookData);

  if (!md5sig) {
    return false;
  }

  const localHash = generateHash({
    merchantId: merchant_id,
    orderId: order_id,
    amount: payhere_amount,
    currency: payhere_currency,
    statusCode: status_code,
  });

  return localHash === md5sig.toUpperCase();
}

/**
 * Create payment record and generate PayHere checkout form
 * 
 * @param {object} params
 * @param {string} params.userId - User ID
 * @param {number|string} params.amount - Payment amount
 * @param {string} params.email - User email
 * @param {string} params.phone - User phone
 * @param {string} params.firstName - User first name
 * @param {string} params.lastName - User last name
 * @param {string} params.address - User address
 * @param {string} params.city - User city
 * @param {string} params.country - User country
 * @returns {Promise<object>} Payment record and checkout form data
 */
export async function initiatePayment({
  userId,
  amount,
  email,
  phone,
  firstName,
  lastName,
  address,
  city,
  country = "Sri Lanka",
}) {
  // Validate inputs
  if (!userId) {
    throw new Error("User ID is required");
  }

  if (!amount || new Decimal(amount).lte(0)) {
    throw new Error("Valid amount is required");
  }

  if (!PAYHERE_CONFIG.merchantId || !PAYHERE_CONFIG.merchantSecret) {
    throw new Error("PayHere credentials not configured");
  }

  // Generate unique order ID
  const orderId = `TOPUP_${userId}_${Date.now()}_${uuidv4().substring(0, 8)}`;


  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      userId,
      orderId,
      merchantId: PAYHERE_CONFIG.merchantId,
      amount: new Decimal(amount).toFixed(2),
      currency: "LKR",
      status: "PENDING",
      firstName: firstName || null,
      lastName: lastName || null,
      email: email || null,
      phone: phone || null,
      address: address || null,
      city: city || null,
      country: country || null,
      items: "Wallet Top-Up",
    },
  });

  // Generate hash for checkout
  const hash = generateHash({
    merchantId: PAYHERE_CONFIG.merchantId,
    orderId: payment.orderId,
    amount: payment.amount.toString(),
    currency: payment.currency,
  });

  // Update payment with hash
  await prisma.payment.update({
    where: { id: payment.id },
    data: { hash },
  });

  // Build checkout form data
  const checkoutData = {
    merchant_id: PAYHERE_CONFIG.merchantId,
    return_url: PAYHERE_CONFIG.returnUrl,
    cancel_url: PAYHERE_CONFIG.cancelUrl,
    notify_url: PAYHERE_CONFIG.notifyUrl,
    order_id: payment.orderId,
    items: payment.items,
    currency: payment.currency,
    amount: payment.amount.toString(),
    first_name: payment.firstName || "",
    last_name: payment.lastName || "",
    email: payment.email || "",
    phone: payment.phone || "",
    address: payment.address || "",
    city: payment.city || "",
    country: payment.country || "Sri Lanka",
    hash,
  };

  const checkoutUrl = `${PAYHERE_CONFIG.baseUrl}/pay/checkout`;

  return {
    payment,
    checkoutUrl,
    checkoutData,
  };
}

/**
 * Process PayHere webhook notification
 * 
 * @param {object} webhookData - Webhook payload from PayHere
 * @returns {Promise<object>} Processed payment result
 */
export async function processWebhook(webhookData) {
  const {
    merchant_id,
    order_id,
    payhere_amount,
    payhere_currency,
    status_code,
    md5sig,
    payment_id,
    method,
    status_message,
  } = webhookData;

  // Verify signature
  if (!verifyWebhookSignature(webhookData)) {
    throw new Error("Invalid webhook signature");
  }

  // Find payment record
  const payment = await prisma.payment.findUnique({
    where: { orderId: order_id },
    include: { user: true },
  });

  if (!payment) {
    throw new Error(`Payment not found for order_id: ${order_id}`);
  }

  // Check if already processed
  if (payment.status === "SUCCESS" && status_code === "2") {
    return {
      success: true,
      duplicate: true,
      payment,
      message: "Payment already processed",
    };
  }

  // Map PayHere status code to our status
  const statusMap = {
    "0": "PENDING",
    "1": "PROCESSING",
    "2": "SUCCESS",
    "-1": "CANCELLED",
    "-2": "FAILED",
    "-3": "EXPIRED",
  };

  const newStatus = statusMap[status_code] || "FAILED";

  // Update payment record
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: newStatus,
      payherePaymentId: payment_id || null,
      payhereAmount: payhere_amount ? new Decimal(payhere_amount).toFixed(2) : null,
      payhereCurrency: payhere_currency || null,
      statusCode: status_code,
      statusMessage: status_message || null,
      webhookData: webhookData,
      webhookReceivedAt: new Date(),
      completedAt: newStatus === "SUCCESS" ? new Date() : null,
    },
  });

  return {
    success: true,
    duplicate: false,
    payment: updatedPayment,
    status: newStatus,
    statusCode: status_code,
  };
}

/**
 * Get payment by order ID
 * 
 * @param {string} orderId - PayHere order ID
 * @returns {Promise<object|null>} Payment record
 */
export async function getPaymentByOrderId(orderId) {
  return prisma.payment.findUnique({
    where: { orderId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });
}

/**
 * Get payment by ID
 * 
 * @param {string} paymentId - Payment ID
 * @returns {Promise<object|null>} Payment record
 */
export async function getPaymentById(paymentId) {
  return prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });
}

/**
 * Get user payments
 * 
 * @param {string} userId - User ID
 * @param {object} options - Query options
 * @returns {Promise<object[]>} Payment records
 */
export async function getUserPayments(userId, options = {}) {
  const { limit = 50, offset = 0, status } = options;

  const where = { userId };
  if (status) {
    where.status = status;
  }

  return prisma.payment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
}

export default {
  initiatePayment,
  processWebhook,
  verifyWebhookSignature,
  getPaymentByOrderId,
  getPaymentById,
  getUserPayments,
};





