import { Worker, Queue } from "bullmq";
import { createRedisConnection } from "../config/redis.js";
import settlementService from "../services/settlement.service.js";

/**
 * Settlement Worker
 * 
 * Handles:
 * - Scheduled bi-weekly settlement generation
 * - Settlement notifications
 * - Retry logic for failed settlements
 */

const QUEUE_NAME = "settlement";

let settlementQueue = null;

/**
 * Get or create the settlement queue
 */
export function getSettlementQueue() {
  if (!settlementQueue) {
    settlementQueue = new Queue(QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 60000, // 1 minute
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return settlementQueue;
}

/**
 * Schedule bi-weekly settlement generation
 * 
 * Runs every 2 weeks on Sunday at midnight
 */
export async function scheduleBiWeeklySettlements() {
  const queue = getSettlementQueue();
  
  // Remove existing scheduled jobs
  const existingJobs = await queue.getRepeatableJobs();
  for (const job of existingJobs) {
    if (job.name === "generate-biweekly") {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // Add new repeatable job - every Sunday at midnight
  // Note: For true bi-weekly, you'd need to track the last run in the job handler
  await queue.add(
    "generate-biweekly",
    {},
    {
      repeat: {
        pattern: "0 0 * * 0", // Every Sunday at midnight (weekly check)
      },
    }
  );

  console.log("📅 Bi-weekly settlement generation scheduled");
}

/**
 * Manually trigger settlement generation
 */
export async function triggerSettlementGeneration() {
  const queue = getSettlementQueue();
  const job = await queue.add("generate-manual", {
    manual: true,
    triggeredAt: new Date().toISOString(),
  });

  return job.id;
}

/**
 * Start the settlement worker
 */
export function startSettlementWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`⚙️ Processing settlement job: ${job.name} (${job.id})`);

      try {
        switch (job.name) {
          case "generate-biweekly":
          case "generate-manual":
            return await handleSettlementGeneration(job);

          case "notify-settlement":
            return await handleSettlementNotification(job);

          default:
            console.warn(`Unknown settlement job type: ${job.name}`);
            return { skipped: true };
        }
      } catch (error) {
        console.error(`❌ Settlement job failed: ${job.name}`, error);
        throw error;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 1, // Process one at a time
    }
  );

  worker.on("completed", (job, result) => {
    console.log(`✅ Settlement job completed: ${job.name} (${job.id})`);
  });

  worker.on("failed", (job, error) => {
    console.error(`❌ Settlement job failed: ${job?.name} (${job?.id})`, error.message);
  });

  console.log("💼 Settlement worker started");

  // Schedule bi-weekly settlements
  scheduleBiWeeklySettlements();

  return worker;
}

/**
 * Handle settlement generation job
 */
async function handleSettlementGeneration(job) {
  console.log("📊 Generating bi-weekly settlements...");

  const result = await settlementService.generateBiWeeklySettlements();

  console.log(`📊 Generated ${result.settlements.length} settlements`);

  if (result.errors.length > 0) {
    console.warn(`⚠️ ${result.errors.length} settlements failed:`, result.errors);
  }

  // Queue notification jobs for each settlement
  const queue = getSettlementQueue();
  for (const settlement of result.settlements) {
    await queue.add("notify-settlement", {
      settlementId: settlement.id,
      ownerId: settlement.ownerId,
      netPayout: settlement.netPayout.toString(),
    });
  }

  return {
    settlementsCreated: result.settlements.length,
    errors: result.errors.length,
  };
}

/**
 * Handle settlement notification job
 */
async function handleSettlementNotification(job) {
  const { settlementId, ownerId, netPayout } = job.data;

  console.log(`📧 Sending settlement notification: ${settlementId}`);

  // TODO: Send email or push notification to owner
  // For now, just log
  console.log(`  → Owner: ${ownerId}, Amount: ${netPayout}`);

  return { notified: true };
}

export default {
  getSettlementQueue,
  scheduleBiWeeklySettlements,
  triggerSettlementGeneration,
  startSettlementWorker,
};
