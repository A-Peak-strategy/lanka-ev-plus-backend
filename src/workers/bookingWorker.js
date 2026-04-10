import { Worker } from "bullmq";
import { createRedisConnection } from "../config/redis.js";
import prisma from "../config/db.js";
import bookingService from "../services/booking.service.js";
import { reserveNow } from "../ocpp/commands/reserveNow.js";
import { isChargerOnline } from "../ocpp/ocppServer.js";

/**
 * Booking Worker
 * 
 * Processes booking-related background jobs:
 * - booking-expiry: Handle expired bookings (no-show)
 * - send-reservation: Send OCPP ReserveNow to charger
 */

const BOOKING_QUEUE_NAME = "booking-jobs";

/**
 * Create and start the booking worker
 */
export function createBookingWorker() {
  const worker = new Worker(
    BOOKING_QUEUE_NAME,
    async (job) => {
      console.log(`📅 Processing booking job: ${job.name} (${job.id})`);

      switch (job.name) {
        case "booking-expiry":
          return await handleBookingExpiry(job.data);

        case "send-reservation":
          return await handleSendReservation(job.data);

        default:
          console.warn(`Unknown booking job type: ${job.name}`);
          return { skipped: true, reason: "Unknown job type" };
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 5,
      limiter: {
        max: 20,
        duration: 1000,
      },
    }
  );

  worker.on("completed", (job, result) => {
    console.log(`✅ Booking job ${job.name} completed:`, result);
  });

  worker.on("failed", (job, error) => {
    console.error(`❌ Booking job ${job?.name} failed:`, error.message);
  });

  worker.on("error", (error) => {
    console.error("Booking worker error:", error);
  });

  console.log("🚀 Booking worker started");

  return worker;
}

/**
 * Handle booking expiry (no-show)
 */
async function handleBookingExpiry(data) {
  const { bookingId } = data;

  try {
    const result = await bookingService.handleBookingExpiry(bookingId);
    return result;
  } catch (error) {
    console.error(`Error handling booking expiry:`, error);
    throw error;
  }
}

/**
 * Handle sending OCPP reservation
 */
async function handleSendReservation(data) {
  const { bookingId } = data;

  try {
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
      return { success: false, error: "Booking not found" };
    }

    // Check if booking is still active
    if (booking.status !== "ACTIVE") {
      return { skipped: true, reason: `Booking status is ${booking.status}` };
    }

    // Check if charger is online
    const chargerId = booking.connector.chargerId;
    if (!isChargerOnline(chargerId)) {
      return { skipped: true, reason: "Charger is offline" };
    }

    // Convert booking ID to numeric reservation ID
    const reservationId = hashStringToNumber(bookingId);

    // Send ReserveNow
    const result = await reserveNow(chargerId, {
      connectorId: booking.connector.connectorId,
      idTag: booking.userId,
      expiryDate: booking.expiryTime,
      reservationId,
    });

    if (result.success) {
      console.log(`✅ OCPP reservation sent for booking ${bookingId}`);
    } else {
      console.warn(`⚠️ OCPP reservation failed for booking ${bookingId}: ${result.status}`);
    }

    return result;
  } catch (error) {
    console.error(`Error sending OCPP reservation:`, error);
    throw error;
  }
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

// If running as standalone worker
if (process.argv[1].includes("bookingWorker")) {
  import("dotenv/config").then(() => {
    console.log("Starting booking worker...");
    createBookingWorker();
  });
}

export default createBookingWorker;

