import { Worker } from "bullmq";
import { createRedisConnection } from "../config/redis.js";
import prisma from "../config/db.js";
import { markGraceExecuted } from "../services/gracePeriod.service.js";
import notificationService from "../services/notification.service.js";
import { forceStopForGrace } from "../ocpp/commands/remoteStopTransaction.js";

/**
 * Grace Period Worker
 * 
 * This worker processes grace period expiration jobs.
 * When a user's wallet balance is insufficient and the grace period expires,
 * this worker:
 * 1. Sends RemoteStopTransaction to the charger
 * 2. Updates the session with stop reason
 * 3. Sends notification to the user
 */

const GRACE_QUEUE_NAME = "grace-period";

/**
 * Create and start the grace period worker
 */
export function createGraceWorker() {
  const worker = new Worker(
    GRACE_QUEUE_NAME,
    async (job) => {
      console.log(`⏱️ Processing grace period job: ${job.id}`);

      const { sessionId, transactionId, userId, chargerId } = job.data;

      try {
        // Check if session is still active
        const session = await prisma.chargingSession.findUnique({
          where: { transactionId },
        });

        if (!session) {
          console.log(`Session ${transactionId} not found, skipping`);
          return { skipped: true, reason: "Session not found" };
        }

        if (session.endedAt) {
          console.log(`Session ${transactionId} already ended, skipping`);
          return { skipped: true, reason: "Session already ended" };
        }

        // Check if grace period was cancelled (e.g., user topped up)
        const graceJob = await prisma.gracePeriodJob.findUnique({
          where: { transactionId },
        });

        if (graceJob?.status === "CANCELLED") {
          console.log(`Grace period for ${transactionId} was cancelled`);
          return { skipped: true, reason: "Grace period cancelled" };
        }

        // Force stop the charging session
        const stopResult = await forceStopForGrace(
          chargerId,
          transactionId,
          "Insufficient balance after grace period"
        );

        // Update session with stop reason (if not already stopped by charger)
        if (stopResult.success) {
          await prisma.chargingSession.update({
            where: { transactionId },
            data: {
              stopReason: "GRACE_EXPIRED",
              endedAt: new Date(),
            },
          });
        }

        // Mark grace period as executed
        await markGraceExecuted(transactionId);

        // Send notification to user
        await notificationService.sendChargingForceStopped({
          userId,
          transactionId,
          reason: "Insufficient balance after grace period",
          energyUsedWh: session.energyUsedWh || 0,
          totalCost: session.totalCost?.toString() || "0.00",
        });

        console.log(`✅ Grace period executed for ${transactionId} - charging stopped`);

        return {
          success: true,
          transactionId,
          stopResult,
        };
      } catch (error) {
        console.error(`❌ Error processing grace period job:`, error);
        throw error; // Will trigger retry
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 5,
      limiter: {
        max: 10,
        duration: 1000,
      },
    }
  );

  worker.on("completed", (job, result) => {
    console.log(`✅ Grace job ${job.id} completed:`, result);
  });

  worker.on("failed", (job, error) => {
    console.error(`❌ Grace job ${job?.id} failed:`, error.message);
  });

  worker.on("error", (error) => {
    console.error("Worker error:", error);
  });

  console.log("🚀 Grace period worker started");

  return worker;
}

// If running as standalone worker
if (process.argv[1].includes("graceWorker")) {
  import("dotenv/config").then(() => {
    console.log("Starting grace period worker...");
    createGraceWorker();
  });
}

export default createGraceWorker;
