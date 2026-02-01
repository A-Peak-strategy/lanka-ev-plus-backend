import prisma from "../config/db.js";
import Decimal from "decimal.js";
import connectorLockService from "./connectorLock.service.js";
import walletService from "./wallet.service.js";
import { generateIdempotencyKey, LedgerType } from "./ledger.service.js";
import { reserveNow } from "../ocpp/commands/reserveNow.js";
import { cancelReservation } from "../ocpp/commands/cancelReservation.js";
import { isChargerOnline } from "../ocpp/ocppServer.js";
import { getBookingQueue } from "./bookingQueue.service.js";
import {
  BookingNotFoundError,
  BookingConflictError,
  BookingDisabledError,
  BookingExpiredError,
  ValidationError,
  AuthorizationError,
  NotFoundError,
} from "../errors/index.js";

/**
 * Booking Service
 *
 * Implements SRS booking requirements:
 * - Optional booking (walk-in allowed)
 * - Fixed start time with flexible duration
 * - Arrival grace period
 * - Walk-in allowed after grace expires
 * - Free cancellation
 * - No-show penalty
 * - Owner can disable booking per station
 */

// Default configuration (can be overridden per station)
const DEFAULT_CONFIG = {
  gracePeriodMinutes: 15, // Time to arrive after start time
  maxBookingHours: 24, // Maximum advance booking
  minBookingMinutes: 15, // Minimum booking duration
  maxBookingMinutes: 180, // Maximum booking duration (3 hours)
  noShowPenaltyAmount: 100, // LKR penalty for no-show
  noShowPenaltyEnabled: true, // Whether to charge penalty
};

/**
 * Create a new booking
 *
 * @param {object} params
 * @param {string} params.userId - User making the booking
 * @param {string} params.connectorId - Connector DB ID
 * @param {Date} params.startTime - Booking start time
 * @param {number} params.durationMinutes - Expected charging duration
 * @returns {Promise<object>} Booking result
 */
export async function createBooking(params) {
  const { userId, connectorId, startTime, durationMinutes = 60 } = params;

  // Get connector with charger and station info
  const connector = await prisma.connector.findUnique({
    where: { id: connectorId },
    include: {
      charger: {
        include: {
          station: {
            include: {
              owner: true,
            },
          },
        },
      },
    },
  });

  if (!connector) {
    return {
      success: false,
      error: "Connector not found",
    };
  }

  const {
    charger,
    charger: { station },
  } = connector;

  // Check if booking is enabled for this station
  if (station && !station.bookingEnabled) {
    return {
      success: false,
      error: "Booking is disabled for this station",
    };
  }

  // Validate booking time
  const validation = validateBookingTime(startTime, durationMinutes);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  // Check availability using Redis locks
  const availability = await connectorLockService.checkAvailability(
    charger.id,
    connector.connectorId,
    new Date(startTime),
    durationMinutes,
  );

  if (!availability.available) {
    return {
      success: false,
      error: availability.reason,
      conflicts: availability.conflicts,
    };
  }

  // Check user doesn't have conflicting bookings
  const userConflict = await checkUserConflictingBookings(
    userId,
    startTime,
    durationMinutes,
  );
  if (userConflict) {
    return {
      success: false,
      error: "You already have a booking at this time",
      existingBooking: userConflict,
    };
  }

  // Calculate expiry time (start + duration + grace period)
  const config = getStationConfig(station);
  const expiryTime = new Date(
    new Date(startTime).getTime() +
      (durationMinutes + config.gracePeriodMinutes) * 60 * 1000,
  );

  // Create booking in database
  const booking = await prisma.booking.create({
    data: {
      userId,
      connectorId,
      startTime: new Date(startTime),
      expiryTime,
      status: "ACTIVE",
    },
    include: {
      connector: {
        include: {
          charger: true,
        },
      },
    },
  });

  // Reserve time slots in Redis
  const slotReservation = await connectorLockService.reserveTimeSlots({
    chargerId: charger.id,
    connectorId: connector.connectorId,
    bookingId: booking.id,
    startTime: new Date(startTime),
    durationMinutes,
    graceMinutes: config.gracePeriodMinutes,
  });

  if (!slotReservation.reserved) {
    // Rollback database booking
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CANCELLED" },
    });

    return {
      success: false,
      error:
        "Failed to reserve time slot - may have been booked by another user",
    };
  }

  // Send OCPP ReserveNow to charger (if online and start time is soon)
  const minutesUntilStart =
    (new Date(startTime).getTime() - Date.now()) / 60000;
  let ocppReservation = null;

  if (isChargerOnline(charger.id) && minutesUntilStart <= 30) {
    // Reserve immediately if booking is within 30 minutes
    ocppReservation = await sendOcppReservation(
      booking,
      charger.id,
      connector.connectorId,
      expiryTime,
    );
  }

  // Schedule booking expiry job
  await scheduleBookingExpiry(booking.id, expiryTime);

  // Schedule OCPP reservation if start time is in the future
  if (!ocppReservation && minutesUntilStart > 5) {
    await scheduleOcppReservation(booking.id, new Date(startTime));
  }

  return {
    success: true,
    booking: {
      id: booking.id,
      connectorId: booking.connectorId,
      startTime: booking.startTime,
      expiryTime: booking.expiryTime,
      status: booking.status,
      charger: {
        id: charger.id,
        station: station?.name,
      },
    },
    ocppReservation,
  };
}

/**
 * Cancel a booking
 *
 * Free cancellation as per SRS
 *
 * @param {string} bookingId
 * @param {string} userId - Must be the booking owner
 * @returns {Promise<object>}
 */
export async function cancelBooking(bookingId, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      connector: {
        include: {
          charger: true,
        },
      },
    },
  });

  if (!booking) {
    throw new BookingNotFoundError(bookingId);
  }

  if (booking.userId !== userId) {
    throw new AuthorizationError("Not authorized to cancel this booking");
  }

  if (booking.status !== "ACTIVE") {
    throw new BookingExpiredError(bookingId);
  }

  // Update booking status
  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "CANCELLED" },
  });

  // Release Redis time slots
  await connectorLockService.releaseTimeSlots(
    booking.connector.chargerId,
    booking.connector.connectorId,
    bookingId,
    booking.startTime,
    60, // Assume 1 hour, actual slots will be cleaned up
  );

  // Cancel OCPP reservation on charger
  if (isChargerOnline(booking.connector.chargerId)) {
    const reservationId = hashStringToNumber(bookingId);
    await cancelReservation(booking.connector.chargerId, reservationId).catch(
      (err) => {
        console.warn("Failed to cancel OCPP reservation:", err.message);
      },
    );
  }

  return {
    success: true,
    message: "Booking cancelled successfully",
    refunded: true, // Free cancellation
  };
}

/**
 * Mark booking as used (when charging starts)
 *
 * @param {string} bookingId
 * @returns {Promise<object>}
 */
export async function markBookingUsed(bookingId) {
  const booking = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "USED" },
  });

  return { success: true, booking };
}

/**
 * Handle booking expiry (no-show)
 *
 * Called by the booking expiry worker
 *
 * @param {string} bookingId
 * @returns {Promise<object>}
 */
export async function handleBookingExpiry(bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      connector: {
        include: {
          charger: {
            include: {
              station: true,
            },
          },
        },
      },
      user: {
        include: {
          wallet: true,
        },
      },
    },
  });

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  // Already processed
  if (booking.status !== "ACTIVE") {
    return {
      success: true,
      skipped: true,
      reason: `Status is ${booking.status}`,
    };
  }

  const { connector, user } = booking;
  const config = getStationConfig(connector.charger.station);

  // Mark as expired
  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "EXPIRED" },
  });

  // Release Redis locks
  await connectorLockService.releaseTimeSlots(
    connector.chargerId,
    connector.connectorId,
    bookingId,
    booking.startTime,
    60,
  );

  // Cancel OCPP reservation
  if (isChargerOnline(connector.chargerId)) {
    const reservationId = hashStringToNumber(bookingId);
    await cancelReservation(connector.chargerId, reservationId).catch(() => {});
  }

  // Apply no-show penalty if enabled
  let penaltyApplied = false;
  if (config.noShowPenaltyEnabled && user?.wallet) {
    const penaltyResult = await applyNoShowPenalty(
      user.id,
      bookingId,
      config.noShowPenaltyAmount,
    );
    penaltyApplied = penaltyResult.success;
  }

  console.log(
    `📅 Booking ${bookingId} expired (no-show), penalty: ${penaltyApplied}`,
  );

  return {
    success: true,
    expired: true,
    penaltyApplied,
    penaltyAmount: penaltyApplied ? config.noShowPenaltyAmount : 0,
  };
}

/**
 * Validate booking for charging start
 *
 * Called during StartTransaction to check if the user has a valid booking
 * or if walk-in is allowed
 *
 * @param {string} chargerId
 * @param {number} connectorId
 * @param {string} idTag - User identifier
 * @returns {Promise<object>}
 */
export async function validateBookingForStart(chargerId, connectorId, idTag) {
  const now = new Date();

  // Find connector
  const connector = await prisma.connector.findFirst({
    where: {
      chargerId,
      connectorId,
    },
  });

  if (!connector) {
    // Connector not in DB, allow charging (walk-in)
    return {
      allowed: true,
      type: "WALKIN",
      reason: "Connector not registered",
    };
  }

  // Check for active booking on this connector
  const activeBooking = await prisma.booking.findFirst({
    where: {
      connectorId: connector.id,
      status: "ACTIVE",
      startTime: { lte: now },
      expiryTime: { gte: now },
    },
    include: {
      user: true,
    },
  });

  if (!activeBooking) {
    // No active booking - allow walk-in
    return { allowed: true, type: "WALKIN" };
  }

  // There's an active booking - check if it belongs to this user
  const userId = await resolveUserFromIdTag(idTag);

  if (userId && activeBooking.userId === userId) {
    // User has a booking - allow and mark as used
    await markBookingUsed(activeBooking.id);
    return {
      allowed: true,
      type: "BOOKING",
      bookingId: activeBooking.id,
    };
  }

  // Different user trying to use reserved connector
  return {
    allowed: false,
    type: "RESERVED",
    reason: "Connector is reserved for another user",
    bookingExpiresAt: activeBooking.expiryTime,
  };
}

/**
 * Check if walk-in is allowed on a connector
 *
 * Walk-in is allowed if:
 * - No active booking
 * - Active booking has expired (grace period passed)
 *
 * @param {string} chargerId
 * @param {number} connectorId
 * @returns {Promise<object>}
 */
export async function checkWalkInAllowed(chargerId, connectorId) {
  const connector = await prisma.connector.findFirst({
    where: { chargerId, connectorId },
  });

  if (!connector) {
    return { allowed: true };
  }

  const now = new Date();

  // Check for unexpired active booking
  const activeBooking = await prisma.booking.findFirst({
    where: {
      connectorId: connector.id,
      status: "ACTIVE",
      expiryTime: { gt: now },
    },
  });

  if (activeBooking) {
    return {
      allowed: false,
      reason: "Connector is reserved",
      reservedUntil: activeBooking.expiryTime,
    };
  }

  return { allowed: true };
}

/**
 * Get user's bookings
 *
 * @param {string} userId
 * @param {object} options
 * @returns {Promise<object[]>}
 */
export async function getUserBookings(userId, options = {}) {
  const { status, limit = 20, offset = 0 } = options;

  const where = { userId };
  if (status) {
    where.status = status;
  }

  const bookings = await prisma.booking.findMany({
    where,
    include: {
      connector: {
        include: {
          charger: {
            include: {
              station: true,
            },
          },
        },
      },
    },
    orderBy: { startTime: "desc" },
    take: limit,
    skip: offset,
  });

  return bookings.map(formatBookingResponse);
}

/**
 * Get upcoming bookings for a connector
 *
 * @param {string} chargerId
 * @param {number} connectorId
 * @param {number} hoursAhead
 * @returns {Promise<object[]>}
 */
export async function getConnectorBookings(
  chargerId,
  connectorId,
  hoursAhead = 24,
) {
  const now = new Date();
  const future = new Date();
  future.setHours(future.getHours() + hoursAhead);

  const connector = await prisma.connector.findFirst({
    where: { chargerId, connectorId },
  });

  if (!connector) {
    return [];
  }

  const bookings = await prisma.booking.findMany({
    where: {
      connectorId: connector.id,
      status: "ACTIVE",
      startTime: {
        gte: now,
        lte: future,
      },
    },
    orderBy: { startTime: "asc" },
  });

  return bookings.map((b) => ({
    startTime: b.startTime,
    expiryTime: b.expiryTime,
    // Don't expose user info in public endpoint
  }));
}

// ============================================
// Helper Functions
// ============================================

/**
 * Validate booking time constraints
 */
function validateBookingTime(startTime, durationMinutes) {
  const start = new Date(startTime);
  const now = new Date();
  const config = DEFAULT_CONFIG;

  // Start time must be in the future
  if (start <= now) {
    return { valid: false, error: "Booking start time must be in the future" };
  }

  // Not too far in the future
  const maxFuture = new Date();
  maxFuture.setHours(maxFuture.getHours() + config.maxBookingHours);
  if (start > maxFuture) {
    return {
      valid: false,
      error: `Cannot book more than ${config.maxBookingHours} hours in advance`,
    };
  }

  // Duration constraints
  if (durationMinutes < config.minBookingMinutes) {
    return {
      valid: false,
      error: `Minimum booking duration is ${config.minBookingMinutes} minutes`,
    };
  }

  if (durationMinutes > config.maxBookingMinutes) {
    return {
      valid: false,
      error: `Maximum booking duration is ${config.maxBookingMinutes} minutes`,
    };
  }

  return { valid: true };
}

/**
 * Check for user's conflicting bookings
 */
async function checkUserConflictingBookings(
  userId,
  startTime,
  durationMinutes,
) {
  const start = new Date(startTime);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + durationMinutes);

  return prisma.booking.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      OR: [
        {
          // New booking starts during existing booking
          startTime: { lte: start },
          expiryTime: { gt: start },
        },
        {
          // New booking ends during existing booking
          startTime: { lt: end },
          expiryTime: { gte: end },
        },
        {
          // New booking contains existing booking
          startTime: { gte: start },
          expiryTime: { lte: end },
        },
      ],
    },
  });
}

/**
 * Get station-specific config or defaults
 */
function getStationConfig(station) {
  // Could be extended to read from station.settings JSON field
  return { ...DEFAULT_CONFIG };
}

/**
 * Apply no-show penalty
 *
 * Uses a separate ledger entry type for penalties (recorded as CHARGE_DEBIT with penalty metadata)
 */
async function applyNoShowPenalty(userId, bookingId, amount) {
  const idempotencyKey = generateIdempotencyKey("noshow", bookingId);

  try {
    // Check if user has sufficient balance
    const balanceCheck = await walletService.checkSufficientBalance(
      userId,
      amount,
    );

    if (!balanceCheck.sufficient) {
      // Deduct what's available, track the rest as owed (not implemented - just log)
      console.warn(
        `[BOOKING] User ${userId} cannot pay full no-show penalty: ${amount}`,
      );
      // For now, skip penalty if insufficient funds
      return { success: false, error: "Insufficient balance for penalty" };
    }

    // Use deductForCharging but with penalty metadata
    const result = await walletService.deductForCharging({
      userId,
      amount,
      transactionId: bookingId,
      idempotencyKey,
      energyWh: 0, // Penalty, not energy
    });

    if (result.success) {
      return { success: true, amount };
    }

    return { success: false, error: result.reason || "Deduction failed" };
  } catch (error) {
    console.error("Failed to apply no-show penalty:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send OCPP ReserveNow to charger
 */
async function sendOcppReservation(
  booking,
  chargerId,
  connectorId,
  expiryTime,
) {
  try {
    const reservationId = hashStringToNumber(booking.id);
    const result = await reserveNow(chargerId, {
      connectorId,
      idTag: booking.userId,
      expiryDate: expiryTime,
      reservationId,
    });

    return result;
  } catch (error) {
    console.error("Failed to send OCPP reservation:", error);
    return null;
  }
}

/**
 * Schedule booking expiry job
 */
async function scheduleBookingExpiry(bookingId, expiryTime) {
  try {
    const queue = getBookingQueue();
    const delay = Math.max(0, expiryTime.getTime() - Date.now());

    await queue.add(
      "booking-expiry",
      { bookingId },
      {
        delay,
        jobId: `expiry-${bookingId}`,
        removeOnComplete: true,
      },
    );
  } catch (error) {
    console.error("Failed to schedule booking expiry:", error);
  }
}

/**
 * Schedule OCPP reservation (for future bookings)
 */
async function scheduleOcppReservation(bookingId, startTime) {
  try {
    const queue = getBookingQueue();
    // Send reservation 5 minutes before start
    const reserveAt = new Date(startTime);
    reserveAt.setMinutes(reserveAt.getMinutes() - 5);
    const delay = Math.max(0, reserveAt.getTime() - Date.now());

    await queue.add(
      "send-reservation",
      { bookingId },
      {
        delay,
        jobId: `reserve-${bookingId}`,
        removeOnComplete: true,
      },
    );
  } catch (error) {
    console.error("Failed to schedule OCPP reservation:", error);
  }
}

/**
 * Resolve user ID from idTag
 */
async function resolveUserFromIdTag(idTag) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id: idTag }, { firebaseUid: idTag }],
    },
  });

  return user?.id || null;
}

/**
 * Format booking for API response
 */
function formatBookingResponse(booking) {
  return {
    id: booking.id,
    startTime: booking.startTime,
    expiryTime: booking.expiryTime,
    status: booking.status,
    charger: booking.connector?.charger
      ? {
          id: booking.connector.charger.id,
          connectorId: booking.connector.connectorId,
          station: booking.connector.charger.station?.name,
          address: booking.connector.charger.station?.address,
        }
      : null,
    createdAt: booking.createdAt,
  };
}

/**
 * Convert string ID to numeric for OCPP reservation ID
 */
function hashStringToNumber(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export default {
  createBooking,
  cancelBooking,
  markBookingUsed,
  handleBookingExpiry,
  validateBookingForStart,
  checkWalkInAllowed,
  getUserBookings,
  getConnectorBookings,
};
