import { Queue } from "bullmq";
import { createRedisConnection, checkRedisAvailable } from "../config/redis.js";

/**
 * Booking Queue Service
 * 
 * Manages booking-related background jobs:
 * - booking-expiry: Handle expired bookings (no-show)
 * - send-reservation: Send OCPP ReserveNow before booking start
 * - cancel-reservation: Cancel OCPP reservation
 * 
 * Falls back gracefully if Redis is unavailable.
 */

const BOOKING_QUEUE_NAME = "booking-jobs";

let bookingQueue = null;
let redisAvailable = null;

/**
 * Check if Redis is available for queue operations
 */
async function isRedisAvailable() {
  if (redisAvailable === null) {
    redisAvailable = await checkRedisAvailable();
    if (!redisAvailable) {
      console.warn("⚠️ BookingQueue: Redis unavailable, job scheduling disabled");
    }
  }
  return redisAvailable;
}

/**
 * Get or create the booking queue
 */
export function getBookingQueue() {
  if (!bookingQueue) {
    bookingQueue = new Queue(BOOKING_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    });
  }
  return bookingQueue;
}

/**
 * Schedule a booking expiry check
 * 
 * @param {string} bookingId
 * @param {Date} expiryTime
 */
export async function scheduleBookingExpiry(bookingId, expiryTime) {
  if (!(await isRedisAvailable())) {
    console.warn(`⚠️ Cannot schedule booking expiry for ${bookingId} - Redis unavailable`);
    return;
  }

  try {
    const queue = getBookingQueue();
    const delay = Math.max(0, new Date(expiryTime).getTime() - Date.now());

    await queue.add(
      "booking-expiry",
      { bookingId },
      {
        delay,
        jobId: `expiry-${bookingId}`,
      }
    );

    console.log(`📅 Scheduled booking expiry for ${bookingId} in ${Math.round(delay / 1000)}s`);
  } catch (error) {
    console.error(`Failed to schedule booking expiry:`, error.message);
  }
}

/**
 * Cancel a scheduled booking expiry
 * 
 * @param {string} bookingId
 */
export async function cancelScheduledExpiry(bookingId) {
  if (!(await isRedisAvailable())) {
    return;
  }

  try {
    const queue = getBookingQueue();
    const job = await queue.getJob(`expiry-${bookingId}`);
    if (job) {
      await job.remove();
      console.log(`📅 Cancelled scheduled expiry for ${bookingId}`);
    }
  } catch (error) {
    console.error(`Error cancelling scheduled expiry:`, error.message);
  }
}

/**
 * Schedule OCPP reservation to be sent
 * 
 * @param {string} bookingId
 * @param {Date} sendAt - When to send the reservation
 */
export async function scheduleOcppReservation(bookingId, sendAt) {
  if (!(await isRedisAvailable())) {
    console.warn(`⚠️ Cannot schedule OCPP reservation for ${bookingId} - Redis unavailable`);
    return;
  }

  try {
    const queue = getBookingQueue();
    const delay = Math.max(0, new Date(sendAt).getTime() - Date.now());

    await queue.add(
      "send-reservation",
      { bookingId },
      {
        delay,
        jobId: `reserve-${bookingId}`,
      }
    );

    console.log(`📅 Scheduled OCPP reservation for ${bookingId} in ${Math.round(delay / 1000)}s`);
  } catch (error) {
    console.error(`Failed to schedule OCPP reservation:`, error.message);
  }
}

export default {
  getBookingQueue,
  scheduleBookingExpiry,
  cancelScheduledExpiry,
  scheduleOcppReservation,
};
