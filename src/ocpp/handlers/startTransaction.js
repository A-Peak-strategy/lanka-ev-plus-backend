import { sendCallResult } from "../messageQueue.js";
import { AuthorizationStatus } from "../ocppConstants.js";
import { updateChargerState } from "../../services/chargerStore.service.js";
import { generateTransactionId } from "../../utils/generateTransactionId.js";
import { ocppEvents } from "../ocppEvents.js";
import sessionService from "../../services/session.service.js";
import billingService from "../../services/billing.service.js";
import bookingService from "../../services/booking.service.js";
import connectorLockService from "../../services/connectorLock.service.js";
import prisma from "../../config/db.js";
import Decimal from "decimal.js";

/**
 * OCPP StartTransaction Handler
 * 
 * Sent by the Charge Point when a charging session starts.
 * 
 * IMPORTANT: Per OCPP 1.6 Section 6.46, transactionId MUST be an integer.
 * We use the DB autoincrement session.id as the OCPP transactionId, and
 * keep the string-based transactionId for internal reference/billing.
 * 
 * Request: {
 *   connectorId: number (Required),
 *   idTag: CiString20Type (Required),
 *   meterStart: integer Wh (Required),
 *   reservationId?: integer,
 *   timestamp: ISO8601 (Required)
 * }
 * 
 * Response: {
 *   transactionId: integer (Required),
 *   idTagInfo: { status: AuthorizationStatus, expiryDate?, parentIdTag? } (Required)
 * }
 */
export default async function startTransaction(ws, messageId, chargerId, payload) {
  const {
    connectorId,
    idTag,
    meterStart,
    reservationId,
    timestamp,
    status,
  } = payload;

  const startTime = timestamp ? new Date(timestamp) : new Date();

  console.log(`[START] ${chargerId}#${connectorId}: idTag=${idTag}, meter=${meterStart}Wh`);

  // Generate internal transaction ID string (for billing, ledger, etc.)
  const internalTransactionId = generateTransactionId(chargerId);

  // Check authorization
  const authResult = await checkStartAuthorization(chargerId, connectorId, idTag, reservationId);

  if (authResult.status !== AuthorizationStatus.ACCEPTED) {
    console.log(`[START] Rejected: ${authResult.status} - ${authResult.reason || ''}`);
    sendCallResult(ws, messageId, {
      transactionId: 0,
      idTagInfo: {
        status: authResult.status,
      },
    });
    return;
  }

  // Get pricing for this charger
  const pricing = await billingService.getPricingForCharger(chargerId);

  // Resolve user from idTag
  const userId = await resolveUserFromIdTag(idTag);

  // Acquire connector lock for this charging session
  const lockResult = await connectorLockService.markChargingActive(
    chargerId,
    connectorId,
    internalTransactionId
  );

  if (!lockResult.acquired) {
    console.log(`[START] Connector lock failed: ${lockResult.reason}`);
    // Still allow - lock is for booking system, not hard requirement
  }

  // Create session in database
  // session.id (autoincrement integer) will be used as the OCPP transactionId
  const { session, duplicate } = await sessionService.createSession({
    chargerId,
    connectorId,
    transactionId: internalTransactionId,
    idTag,
    userId,
    meterStart,
    timestamp: startTime,
    pricePerKwh: pricing?.pricePerKwh,
  });


  if (duplicate) {
    console.log(`[START] Duplicate transaction: ${internalTransactionId}`);
  }

  // OCPP transactionId MUST be an integer (OCPP 1.6 Section 6.46)
  // Use session.id (autoincrement Int from DB) as the OCPP transaction ID
  const ocppTransactionId = session.id;

  // Update charger state - store both IDs for cross-reference
  await updateChargerState(chargerId, {
    status: status || "CHARGING",
    internalTransactionId: internalTransactionId,   // ✅ CORRECT
    transactionId: session.transactionId,  // internal
    ocppTransactionId: session.id,                 // session PK
    connectorId,
    meterStartWh: meterStart,
    lastMeterValueWh: meterStart,
    idTag,
    userId,
    sessionStartTime: startTime,
    bookingId: authResult.bookingId || null,
  });




  // Mark booking as used if applicable
  if (authResult.bookingId) {
    await bookingService.markBookingUsed(authResult.bookingId);
    console.log(`[START] Booking ${authResult.bookingId} marked as used`);
  }

  // Emit event
  ocppEvents.emitSessionStarted({
    chargerId,
    connectorId,
    transactionId: internalTransactionId,
    ocppTransactionId,
    idTag,
    userId,
    meterStart,
    startTime,
    bookingId: authResult.bookingId,
    startType: authResult.type, // BOOKING or WALKIN
  });

  // Send response - transactionId MUST be integer per OCPP 1.6 spec
  sendCallResult(ws, messageId, {
    transactionId: ocppTransactionId,
    idTagInfo: {
      status: AuthorizationStatus.ACCEPTED,
      expiryDate: getExpiryDate(24),
    },
  });

  console.log(`✅ [START] Session ${ocppTransactionId} (internal: ${internalTransactionId}) started (${authResult.type})`);
}

/**
 * Check authorization for starting a transaction
 * Includes booking validation
 */
async function checkStartAuthorization(chargerId, connectorId, idTag, reservationId) {
  // First, validate booking/walk-in status
  const bookingValidation = await bookingService.validateBookingForStart(
    chargerId,
    connectorId,
    idTag
  );

  if (!bookingValidation.allowed) {
    return {
      status: AuthorizationStatus.BLOCKED,
      reason: bookingValidation.reason,
      type: bookingValidation.type,
    };
  }

  // If there's a reservation ID, verify it matches
  if (reservationId) {
    const reservationValid = await validateReservation(chargerId, connectorId, reservationId, idTag);
    if (!reservationValid.valid) {
      return {
        status: AuthorizationStatus.INVALID,
        reason: reservationValid.reason,
        type: "INVALID_RESERVATION",
      };
    }
  }

  // Check user authorization
  const userAuth = await checkUserAuthorization(idTag);
  if (userAuth.status !== AuthorizationStatus.ACCEPTED) {
    return userAuth;
  }

  return {
    status: AuthorizationStatus.ACCEPTED,
    type: bookingValidation.type, // BOOKING or WALKIN
    bookingId: bookingValidation.bookingId,
  };
}

/**
 * Validate OCPP reservation ID
 */
async function validateReservation(chargerId, connectorId, reservationId, idTag) {
  // Find booking by hashed reservation ID
  // This is a reverse lookup - in production you might store the reservationId in the booking

  const connector = await prisma.connector.findFirst({
    where: { chargerId, connectorId },
  });

  if (!connector) {
    return { valid: true }; // No connector tracking, allow
  }

  const activeBooking = await prisma.booking.findFirst({
    where: {
      connectorId: connector.id,
      status: "ACTIVE",
    },
  });

  if (!activeBooking) {
    return { valid: true }; // No booking, allow
  }

  // Check if the user matches the booking
  const userId = await resolveUserFromIdTag(idTag);

  if (userId && activeBooking.userId === userId) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: "Reservation does not match user",
  };
}

/**
 * Check user-level authorization
 */
async function checkUserAuthorization(idTag) {
  // Accept known idTag patterns
  if (idTag.startsWith("USER") || idTag.startsWith("RFID")) {
    return {
      status: AuthorizationStatus.ACCEPTED,
    };
  }

  // Check database for user
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: idTag },
        { firebaseUid: idTag },
      ],
      isActive: true,
    },
    include: {
      wallet: true,
    },
  });

  if (!user) {
    // For development, accept unknown tags
    // In production, return INVALID
    return {
      status: AuthorizationStatus.ACCEPTED,
    };
  }

  // Check for concurrent transactions (optional)
  const activeSessions = await prisma.chargingSession.count({
    where: {
      userId: user.id,
      endedAt: null,
    },
  });

  if (activeSessions > 0) {
    return {
      status: AuthorizationStatus.CONCURRENT_TX,
      reason: "User already has an active charging session",
    };
  }

  // Check wallet balance - user cannot proceed if balance is 0
  const wallet = user.wallet || await prisma.wallet.findUnique({
    where: { userId: user.id },
  });

  if (!wallet) {
    // Create wallet if it doesn't exist
    await prisma.wallet.create({
      data: {
        userId: user.id,
        balance: 0,
        currency: "LKR",
      },
    });
    return {
      status: AuthorizationStatus.BLOCKED,
      reason: "Insufficient wallet balance. Please top up your wallet.",
    };
  }

  const balance = new Decimal(wallet.balance.toString());

  // Minimum wallet balance is 0 - if balance is 0, user cannot proceed
  if (balance.lte(0)) {
    return {
      status: AuthorizationStatus.BLOCKED,
      reason: "Insufficient wallet balance. Please top up your wallet.",
    };
  }

  return {
    status: AuthorizationStatus.ACCEPTED,
    userId: user.id,
  };
}

/**
 * Resolve user ID from idTag
 */
async function resolveUserFromIdTag(idTag) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: idTag },
        { firebaseUid: idTag },
      ],
    },
  });

  return user?.id || null;
}

/**
 * Get expiry date
 */
function getExpiryDate(hours) {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}
