import "dotenv/config";
import http from "http";
import app from "./app.js";
import { startOcppServer } from "./ocpp/ocppServer.js";
import chargerStore from "./services/chargerStore.service.js";
import { syncChargerToDb } from "./services/chargerPersistence.service.js";
import { initializeFirebase } from "./config/firebase.js";
import { checkRedisAvailable } from "./config/redis.js";
import { validateEnv } from "./config/env.js";
import { startMobileSocket } from "./realtime/mobileSocket.js";
import { initTransactionCounter } from "./utils/generateTransactionId.js";

// Validate environment variables before anything else
validateEnv();

// Initialize Firebase (optional - won't crash if not configured)
try {
  initializeFirebase();
} catch (error) {
  console.warn("⚠️ Firebase not initialized:", error.message);
  console.warn("   Push notifications will be disabled");
}

// Create HTTP server
const server = http.createServer(app);

// Start OCPP WebSocket server
startOcppServer(server);
// startMobileSocket(server);

// Start background workers (only if Redis is available)
async function startWorkers() {
  console.log("🔍 Checking Redis availability...");

  const redisAvailable = await checkRedisAvailable();

  if (!redisAvailable) {
    console.warn("⚠️ Redis is not available");
    console.warn("   Background workers (grace period, booking, settlement) are DISABLED");
    console.warn("   To enable: install and start Redis, or set REDIS_URL in .env");
    console.warn("");
    console.warn("   Install Redis:");
    console.warn("     macOS: brew install redis && brew services start redis");
    console.warn("     Ubuntu: sudo apt install redis-server && sudo systemctl start redis");
    console.warn("     Docker: docker run -d -p 6379:6379 redis");
    console.warn("");
    return;
  }

  console.log("✅ Redis is available, starting workers...");

  try {
    // Dynamic imports to avoid loading Redis modules if not available
    const { default: createGraceWorker } = await import("./workers/graceWorker.js");
    const { default: createBookingWorker } = await import("./workers/bookingWorker.js");
    const { startSettlementWorker } = await import("./workers/settlementWorker.js");

    createGraceWorker();
    createBookingWorker();
    startSettlementWorker();

    console.log("✅ All background workers started");
  } catch (error) {
    console.error("❌ Failed to start workers:", error.message);
  }
}

// Start server
const PORT = process.env.PORT || 7070;
server.listen(PORT, async () => {
  console.log("");
  console.log("═══════════════════════════════════════════════════");
  console.log(`🚀 Central System running on port ${PORT}`);
  console.log("═══════════════════════════════════════════════════");
  console.log(`   HTTP API: http://localhost:${PORT}/api`);
  console.log(`   OCPP WS:  ws://localhost:${PORT}/`);
  console.log(`   Health:   http://localhost:${PORT}/health`);
  console.log("═══════════════════════════════════════════════════");
  console.log("");

  // Initialize transaction counter from DB (prevents duplicate IDs after restart)
  await initTransactionCounter();

  // Start workers after server is listening
  await startWorkers();
});


// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\nSIGINT received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
