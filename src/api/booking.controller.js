import bookingService from "../services/booking.service.js";
import connectorLockService from "../services/connectorLock.service.js";
import prisma from "../config/db.js";
import { 
  NotFoundError, 
  AuthenticationError, 
  AuthorizationError,
  ValidationError 
} from "../errors/index.js";
import { 
  validateChargerId, 
  validateConnectorId, 
  validateFutureDate,
  validateInteger,
  validateUUID 
} from "../utils/validation.js";

import { DateTime } from "luxon";

/**
 * Create a new booking
 * 
 * POST /api/bookings
 * 
 * Body:
 * - chargerId: string (required)
 * - connectorId: number (required) - OCPP connector ID (1, 2, etc.)
 * - startTime: ISO8601 (required) - Booking start time
 * - durationMinutes: number (optional, default 60)
 */
export async function createBooking(req, res, next) {
  try {
    // Get userId from authenticated user
    const userId = req.user?.id;

    if (!userId) {
      throw new AuthenticationError("User authentication required");
    }

    const { chargerId, connectorId, startTime, durationMinutes = 60 } = req.body;
    console.log("Create booking request:", req.body);

    // Validate inputs
    if (!chargerId || !connectorId || !startTime) {
      throw new ValidationError("Missing required fields: chargerId, connectorId, startTime");
    }

    validateChargerId(chargerId);
    const validConnectorId = validateConnectorId(connectorId);
    const validStartTime = validateFutureDate(startTime, "startTime");
    const validDuration = validateInteger(durationMinutes, "durationMinutes");

    // Find connector in database
    let connector = await prisma.connector.findFirst({
      where: {
        chargerId,
        connectorId: validConnectorId,
      },
    });

    if (!connector) {
      // Create connector if it doesn't exist
      const charger = await prisma.charger.findUnique({ where: { id: chargerId } });
      
      if (!charger) {
        throw new NotFoundError("Charger", chargerId);
      }

      connector = await prisma.connector.create({
        data: {
          chargerId,
          connectorId: validConnectorId,
          status: "AVAILABLE",
        },
      });
    }

    // Create booking
    const result = await bookingService.createBooking({
      userId,
      connectorId: connector.id,
      startTime: validStartTime,
      durationMinutes: validDuration,
    });

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json({
        success: false,
        errorCode: "BOOKING_FAILED",
        message: result.error,
        conflicts: result.conflicts,
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Cancel a booking
 * 
 * DELETE /api/bookings/:bookingId
 */
export async function cancelBooking(req, res, next) {
  try {
    const userId = req.user?.id;
    const { bookingId } = req.params;

    if (!userId) {
      throw new AuthenticationError("User authentication required");
    }

    validateUUID(bookingId, "bookingId");

    const result = await bookingService.cancelBooking(bookingId, userId);

    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get user's bookings
 * 
 * GET /api/bookings
 * 
 * Query:
 * - status: ACTIVE | USED | CANCELLED | EXPIRED (optional)
 * - limit: number (default 20)
 * - offset: number (default 0)
 */
export async function getUserBookings(req, res, next) {
  try {
    const userId = req.user?.id;
    const { status, limit = 20, offset = 0 } = req.query;

    if (!userId) {
      throw new AuthenticationError("User authentication required");
    }

    // Validate status if provided
    if (status && !["ACTIVE", "USED", "CANCELLED", "EXPIRED"].includes(status)) {
      throw new ValidationError("Invalid status value", "status");
    }

    const bookings = await bookingService.getUserBookings(userId, {
      status,
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0,
    });

    res.json({
      success: true,
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get booking details
 * 
 * GET /api/bookings/:bookingId
 */
export async function getBookingDetails(req, res, next) {
  try {
    const userId = req.user?.id || req.query.userId;
    const { bookingId } = req.params;

    validateUUID(bookingId, "bookingId");

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
      },
    });

    if (!booking) {
      throw new NotFoundError("Booking", bookingId);
    }

    // Check ownership (if userId is provided)
    if (userId && booking.userId !== userId) {
      throw new AuthorizationError("Not authorized to view this booking");
    }

    res.json({
      success: true,
      booking: {
        id: booking.id,
        startTime: booking.startTime,
        expiryTime: booking.expiryTime,
        status: booking.status,
        charger: {
          id: booking.connector.chargerId,
          connectorId: booking.connector.connectorId,
          station: booking.connector.charger.station?.name,
          address: booking.connector.charger.station?.address,
        },
        createdAt: booking.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get connector availability for booking
 * 
 * GET /api/bookings/availability/:chargerId/:connectorId
 * 
 * Query:
 * - date: ISO8601 date (optional, defaults to today)
 * - hoursAhead: number (optional, default 24)
 */
export async function getConnectorAvailability(req, res, next) {
  try {
    const { chargerId, connectorId } = req.params;
    const { date, hoursAhead = 24 } = req.query;

    validateChargerId(chargerId);
    const validConnectorId = validateConnectorId(connectorId);

    // Get existing bookings
    const bookings = await bookingService.getConnectorBookings(
      chargerId,
      validConnectorId,
      parseInt(hoursAhead) || 24
    );

    // Get current lock status
    const lockStatus = await connectorLockService.getLockStatus(
      chargerId,
      validConnectorId
    );

    // Generate available time slots
    const slots = generateAvailableSlots(
      date ? new Date(date) : new Date(),
      parseInt(hoursAhead) || 24,
      bookings
    );

    res.json({
      success: true,
      chargerId,
      connectorId: validConnectorId,
      currentStatus: lockStatus ? lockStatus.type : "AVAILABLE",
      existingBookings: bookings,
      availableSlots: slots,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Generate available time slots
 */
function generateAvailableSlots(startDate, hoursAhead, existingBookings) {
  const slots = [];
  const start = new Date(startDate);
  start.setMinutes(0, 0, 0); // Round to hour

  const end = new Date(start);
  end.setHours(end.getHours() + hoursAhead);

  const current = new Date(start);

  while (current < end) {
    const slotStart = new Date(current);
    const slotEnd = new Date(current);
    slotEnd.setHours(slotEnd.getHours() + 1);

    // Check if slot overlaps with any booking
    const isBooked = existingBookings.some(booking => {
      const bookingStart = new Date(booking.startTime);
      const bookingEnd = new Date(booking.expiryTime);
      return slotStart < bookingEnd && slotEnd > bookingStart;
    });

    if (!isBooked && slotStart > new Date()) {
      slots.push({
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        available: true,
      });
    }

    current.setHours(current.getHours() + 1);
  }

  return slots;
}



// function generateAvailableSlots(startDate, hoursAhead, existingBookings) {
//   const slots = [];

//   // Sri Lanka time
//   let current = DateTime
//     .fromJSDate(startDate)
//     .setZone("Asia/Colombo")
//     .startOf("hour");

//   const end = current.plus({ hours: hoursAhead });

//   while (current < end) {
//     const slotStart = current;
//     const slotEnd = current.plus({ hours: 1 });

//     const isBooked = existingBookings.some(b => {
//       const bookingStart = DateTime.fromJSDate(b.startTime).setZone("Asia/Colombo");
//       const bookingEnd = DateTime.fromJSDate(b.expiryTime).setZone("Asia/Colombo");
//       return slotStart < bookingEnd && slotEnd > bookingStart;
//     });

//     if (!isBooked && slotStart > DateTime.now().setZone("Asia/Colombo")) {
//       slots.push({
//         startTime: slotStart.toISO(),
//         endTime: slotEnd.toISO(),
//         available: true,
//       });
//     }

//     current = current.plus({ hours: 1 });
//   }

//   return slots;
// }

