import { sendCall } from "../messageQueue.js";
import { CStoCPAction, CancelReservationStatus } from "../ocppConstants.js";
import { getChargerConnection, isChargerOnline } from "../ocppServer.js";
import prisma from "../../config/db.js";

/**
 * CancelReservation Command
 * 
 * Sent by Central System to cancel a reservation.
 * 
 * Request: {
 *   reservationId: number
 * }
 * 
 * Response: {
 *   status: "Accepted" | "Rejected"
 * }
 */

/**
 * Send CancelReservation to a charger
 * 
 * @param {string} chargerId - Target charger ID
 * @param {number} reservationId - Reservation to cancel
 * @returns {Promise<object>} Command result
 */
export async function cancelReservation(chargerId, reservationId) {
  if (!reservationId) {
    throw new Error("reservationId is required for CancelReservation");
  }

  // Check if charger is online
  if (!isChargerOnline(chargerId)) {
    return {
      success: false,
      status: "Offline",
      error: "Charger is not connected",
    };
  }

  const ws = getChargerConnection(chargerId);

  try {
    console.log(`[CMD] CancelReservation 1 → ${chargerId} (resId: ${reservationId})`);

    const response = await sendCall(
      ws,
      chargerId,
      CStoCPAction.CANCEL_RESERVATION,
      { reservationId },
      { timeout: 30000 }
    );

    console.log("Response form the ocpp charger when cancel booking", response);

    const accepted = response.status === CancelReservationStatus.ACCEPTED;

    console.log(`[CMD] CancelReservation 2 ← ${chargerId}: ${response.status}`);

    return {
      success: accepted,
      status: response.status,
      chargerId,
      reservationId,
    };
  } catch (error) {
    console.error(`[CMD] CancelReservation error for ${chargerId}:`, error.message);
    return {
      success: false,
      status: "Error",
      error: error.message,
    };
  }
}

/**
 * Cancel a booking and release the reservation
 * 
 * @param {string} bookingId - Booking ID to cancel
 * @returns {Promise<object>}
 */
export async function cancelBooking(bookingId) {
  // Get booking with connector info
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
    return {
      success: false,
      error: "Booking not found",
    };
  }

  if (booking.status !== "ACTIVE") {
    return {
      success: false,
      error: `Booking is not active (status: ${booking.status})`,
    };
  }

  const chargerId = booking.connector.chargerId;
  const reservationId = hashStringToNumber(booking.id);

  // Cancel on charger
  const result = await cancelReservation(chargerId, reservationId);

  // Update booking status regardless of charger response
  // (booking should be cancelled even if charger is offline)
  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "CANCELLED" },
  });

  if (!result.success && result.status !== "Offline") {
    console.warn(`Charger rejected cancellation but booking was cancelled: ${result.status}`);
  }

  return {
    success: true,
    booking: { id: bookingId, status: "CANCELLED" },
    chargerResult: result,
  };
}

/**
 * Cancel expired bookings
 * 
 * Should be run periodically to clean up expired reservations
 * 
 * @returns {Promise<number>} Number of bookings cancelled
 */
export async function cancelExpiredBookings() {
  const now = new Date();

  // Find expired active bookings
  const expiredBookings = await prisma.booking.findMany({
    where: {
      status: "ACTIVE",
      expiryTime: { lt: now },
    },
    include: {
      connector: true,
    },
  });

  let cancelledCount = 0;

  for (const booking of expiredBookings) {
    try {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: "EXPIRED" },
      });

      // Try to cancel on charger (may fail if offline)
      const chargerId = booking.connector.chargerId;
      const reservationId = hashStringToNumber(booking.id);
      
      await cancelReservation(chargerId, reservationId).catch(() => {
        // Ignore errors - charger may be offline
      });

      cancelledCount++;
    } catch (error) {
      console.error(`Error cancelling expired booking ${booking.id}:`, error);
    }
  }

  if (cancelledCount > 0) {
    console.log(`Cancelled ${cancelledCount} expired bookings`);
  }

  return cancelledCount;
}

/**
 * Convert string ID to numeric for OCPP reservation ID
 */
function hashStringToNumber(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export default {
  cancelReservation,
  cancelBooking,
  cancelExpiredBookings,
};

