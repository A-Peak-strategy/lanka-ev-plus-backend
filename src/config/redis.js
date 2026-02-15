import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redisInstance = null;
let redisAvailable = null; // null = not checked, true/false = result

/**
 * Check if Redis is available (with timeout)
 */
export async function checkRedisAvailable() {
  if (redisAvailable !== null) {
    return redisAvailable;
  }

  return new Promise((resolve) => {
    const testConnection = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      connectTimeout: 3000,
      lazyConnect: true,
    });

    // Suppress error logging during availability check
    testConnection.on("error", () => {});

    const timeout = setTimeout(() => {
      testConnection.disconnect();
      redisAvailable = false;
      resolve(false);
    }, 3000);

    testConnection.connect()
      .then(() => {
        clearTimeout(timeout);
        testConnection.disconnect();
        redisAvailable = true;
        resolve(true);
      })
      .catch(() => {
        clearTimeout(timeout);
        testConnection.disconnect();
        redisAvailable = false;
        resolve(false);
      });
  });
}

/**
 * Get or create the main Redis connection (lazy initialization)
 */
export function getRedis() {
  if (!redisInstance) {
    redisInstance = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
    });

    redisInstance.on("connect", () => {
      console.log("✅ Redis connected");
    });

    redisInstance.on("error", (err) => {
      // Only log once, not repeatedly
      if (!redisInstance._errorLogged) {
        console.warn("⚠️ Redis connection error:", err.message);
        redisInstance._errorLogged = true;
      }
    });
  }

  return redisInstance;
}

/**
 * Create a new Redis connection for BullMQ workers (required for proper pub/sub)
 */
export function createRedisConnection() {
  const connection = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  connection.on("error", (err) => {
    // Suppress repeated error logs
    if (!connection._errorLogged) {
      console.warn("⚠️ Redis worker connection error:", err.message);
      connection._errorLogged = true;
    }
  });

  return connection;
}

// Legacy export for compatibility (lazy getter)
export const redis = {
  get instance() {
    return getRedis();
  },
};

export default {
  getRedis,
  createRedisConnection,
  checkRedisAvailable,
};
