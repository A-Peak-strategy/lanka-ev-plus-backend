import { sendCall } from "../messageQueue.js";
import { CStoCPAction, ReservationStatus } from "../ocppConstants.js";
import { getChargerConnection, isChargerOnline } from "../ocppServer.js";
import prisma from "../../config/db.js";

/**
 * ReserveNow Command
 * 
 * Sent by Central System to reserve a connector for a specific user.
 * 
 * Request: {
 *   connectorId: number,
 *   expiryDate: ISO8601,
 *   idTag: string,
 *   parentIdTag?: string,
 *   reservationId: number
 * }
 * 
 * Response: {
 *   status: "Accepted" | "Faulted" | "Occupied" | "Rejected" | "Unavailable"
 * }
 */

/**
 * Send ReserveNow to a charger
 * 
 * @param {string} chargerId - Target charger ID
 * @param {object} options - Reservation options
 * @param {number} options.connectorId - Connector to reserve
 * @param {string} options.idTag - User identifier
 * @param {Date|string} options.expiryDate - Reservation expiry time
 * @param {number} options.reservationId - Unique reservation ID
 * @returns {Promise<object>} Command result
 */
export async function reserveNow(chargerId, options) {
  const { connectorId, idTag, expiryDate, reservationId } = options;

  if (!connectorId || !idTag || !expiryDate || !reservationId) {
    throw new Error("connectorId, idTag, expiryDate, and reservationId are required");
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

  // Format expiry date
  const expiry = typeof expiryDate === "string" 
    ? expiryDate 
    : expiryDate.toISOString();

  const payload = {
    connectorId,
    expiryDate: expiry,
    idTag,
    reservationId,
  };

  try {
    console.log(`[CMD] ReserveNow → ${chargerId}#${connectorId} (resId: ${reservationId})`);

    const response = await sendCall(
      ws,
      chargerId,
      CStoCPAction.RESERVE_NOW,
      payload,
      { timeout: 30000 }
    );

    const accepted = response.status === ReservationStatus.ACCEPTED;

    console.log(`[CMD] ReserveNow ← ${chargerId}: ${response.status}`);

    return {
      success: accepted,
      status: response.status,
      chargerId,
      connectorId,
      reservationId,
      expiryDate: expiry,
    };
  } catch (error) {
    console.error(`[CMD] ReserveNow error for ${chargerId}:`, error.message);
    return {
      success: false,
      status: "Error",
      error: error.message,
    };
  }
}

/**
 * Create a booking and reserve the connector
 * 
 * @param {object} params
 * @param {string} params.userId - User making the booking
 * @param {string} params.chargerId - Charger ID
 * @param {number} params.connectorId - Connector ID
 * @param {Date} params.startTime - Booking start time
 * @param {number} params.durationMinutes - Reservation duration
 * @returns {Promise<object>}
 */
export async function createBookingWithReservation(params) {
  const { userId, chargerId, connectorId, startTime, durationMinutes = 30 } = params;

  // Calculate expiry time
  const expiryDate = new Date(startTime);
  expiryDate.setMinutes(expiryDate.getMinutes() + durationMinutes);

  // Get connector from database
  const connector = await prisma.connector.findFirst({
    where: {
      chargerId,
      connectorId,
    },
  });

  if (!connector) {
    return {
      success: false,
      error: "Connector not found",
    };
  }

  // Create booking in database
  const booking = await prisma.booking.create({
    data: {
      userId,
      connectorId: connector.id,
      startTime: new Date(startTime),
      expiryTime: expiryDate,
      status: "ACTIVE",
    },
  });

  // Use booking ID as reservation ID (needs to be numeric for OCPP)
  // Hash or convert string ID to number
  const reservationId = hashStringToNumber(booking.id);

  // Send ReserveNow to charger
  const result = await reserveNow(chargerId, {
    connectorId,
    idTag: userId,
    expiryDate,
    reservationId,
  });

  if (!result.success) {
    // Rollback booking if charger rejects
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CANCELLED" },
    });

    return {
      success: false,
      error: `Charger rejected reservation: ${result.status}`,
      chargerStatus: result.status,
    };
  }

  return {
    success: true,
    booking,
    reservationId,
    expiryDate,
  };
}

/**
 * Convert string ID to numeric for OCPP reservation ID
 */
function hashStringToNumber(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

export default {
  reserveNow,
  createBookingWithReservation,
};

