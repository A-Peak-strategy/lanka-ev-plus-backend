import { Queue } from "bullmq";
import prisma from "../config/db.js";
import { createRedisConnection, checkRedisAvailable } from "../config/redis.js";

/**
 * Grace Period Service
 * 
 * Manages grace periods for low-balance charging sessions using BullMQ.
 * Falls back to database-only tracking if Redis is unavailable.
 * 
 * When a user's balance runs out during charging:
 * 1. Grace period starts (default 60 seconds)
 * 2. A delayed job is created in BullMQ (if available)
 * 3. User can top up wallet to cancel grace period
 * 4. If grace period expires, worker force-stops the charging session
 */

// Queue name
const GRACE_QUEUE_NAME = "grace-period";

// Create queue with Redis connection
let graceQueue = null;
let redisAvailable = null;

/**
 * Check if Redis is available for queue operations
 */
async function isRedisAvailable() {
  if (redisAvailable === null) {
    redisAvailable = await checkRedisAvailable();
    if (!redisAvailable) {
      console.warn("⚠️ GracePeriod: Redis unavailable, using database-only tracking");
    }
  }
  return redisAvailable;
}

/**
 * Get or create the grace period queue
 */
export function getGraceQueue() {
  if (!graceQueue) {
    graceQueue = new Queue(GRACE_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50, // Keep last 50 failed jobs for debugging
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    });
  }
  return graceQueue;
}

/**
 * Start a grace period for a session
 * 
 * @param {object} params
 * @param {number} params.sessionId - ChargingSession ID
 * @param {string} params.transactionId - OCPP transaction ID
 * @param {string} params.userId - User ID
 * @param {number} params.gracePeriodSec - Grace period duration in seconds
 * @param {string} params.chargerId - Charger ID
 * @returns {Promise<object>} Job info
 */
export async function startGracePeriod({
  sessionId,
  transactionId,
  userId,
  gracePeriodSec,
  chargerId,
}) {
  const expiresAt = new Date(Date.now() + gracePeriodSec * 1000);

  // Check if grace period already exists
  const existing = await prisma.gracePeriodJob.findUnique({
    where: { transactionId },
  });

  if (existing && existing.status === "ACTIVE") {
    // Already has an active grace period
    return {
      exists: true,
      jobId: existing.bullJobId,
      expiresAt: existing.expiresAt,
    };
  }

  let jobId = `grace-${transactionId}-${Date.now()}`;

  // Try to create BullMQ job if Redis is available
  if (await isRedisAvailable()) {
    try {
      const queue = getGraceQueue();
      const job = await queue.add(
        "force-stop",
        {
          sessionId,
          transactionId,
          userId,
          chargerId,
          startedAt: new Date().toISOString(),
        },
        {
          delay: gracePeriodSec * 1000, // Convert to milliseconds
          jobId: `grace-${transactionId}`, // Unique job ID for deduplication
        }
      );
      jobId = job.id;
    } catch (error) {
      console.warn("⚠️ Failed to create BullMQ job, using database-only:", error.message);
    }
  }

  // Track job in database (always)
  await prisma.gracePeriodJob.upsert({
    where: { transactionId },
    create: {
      sessionId,
      transactionId,
      userId,
      bullJobId: jobId,
      expiresAt,
      status: "ACTIVE",
    },
    update: {
      bullJobId: jobId,
      expiresAt,
      status: "ACTIVE",
    },
  });

  console.log(
    `⏱️ Grace period started for ${transactionId}, expires at ${expiresAt.toISOString()}`
  );

  return {
    exists: false,
    jobId,
    expiresAt,
  };
}

/**
 * Cancel a grace period (e.g., when user tops up)
 * 
 * @param {string} transactionId
 * @returns {Promise<object>} Result
 */
export async function cancelGracePeriod(transactionId) {
  // Find the job record
  const jobRecord = await prisma.gracePeriodJob.findUnique({
    where: { transactionId },
  });

  if (!jobRecord || jobRecord.status !== "ACTIVE") {
    return { cancelled: false, reason: "No active grace period" };
  }

  try {
    // Try to remove the job from BullMQ if Redis is available
    if (await isRedisAvailable()) {
      try {
        const queue = getGraceQueue();
        const job = await queue.getJob(`grace-${transactionId}`);
        if (job) {
          await job.remove();
        }
      } catch (error) {
        console.warn("⚠️ Failed to remove BullMQ job:", error.message);
      }
    }

    // Update database record (always)
    await prisma.gracePeriodJob.update({
      where: { transactionId },
      data: {
        status: "CANCELLED",
      },
    });

    console.log(`✅ Grace period cancelled for ${transactionId}`);

    return { cancelled: true };
  } catch (error) {
    console.error(`Error cancelling grace period for ${transactionId}:`, error);
    return { cancelled: false, error: error.message };
  }
}

/**
 * Mark grace period as executed (called by worker)
 * 
 * @param {string} transactionId
 * @returns {Promise<void>}
 */
export async function markGraceExecuted(transactionId) {
  await prisma.gracePeriodJob.update({
    where: { transactionId },
    data: {
      status: "EXECUTED",
    },
  });
}

/**
 * Get grace period status for a session
 * 
 * @param {string} transactionId
 * @returns {Promise<object|null>} Grace period info
 */
export async function getGracePeriodStatus(transactionId) {
  const jobRecord = await prisma.gracePeriodJob.findUnique({
    where: { transactionId },
  });

  if (!jobRecord) {
    return null;
  }

  const now = new Date();
  const remainingSec = Math.max(
    0,
    Math.floor((jobRecord.expiresAt.getTime() - now.getTime()) / 1000)
  );

  return {
    status: jobRecord.status,
    expiresAt: jobRecord.expiresAt,
    remainingSec,
    isExpired: now >= jobRecord.expiresAt,
  };
}

/**
 * Clean up old grace period records
 * 
 * @param {number} olderThanDays - Remove records older than this
 * @returns {Promise<number>} Number of records deleted
 */
export async function cleanupOldGracePeriods(olderThanDays = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const result = await prisma.gracePeriodJob.deleteMany({
    where: {
      status: { in: ["CANCELLED", "EXECUTED"] },
      createdAt: { lt: cutoff },
    },
  });

  return result.count;
}

export default {
  getGraceQueue,
  startGracePeriod,
  cancelGracePeriod,
  markGraceExecuted,
  getGracePeriodStatus,
  cleanupOldGracePeriods,
};
