import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import chargerRoutes from "./api/charger.routes.js";
import walletRoutes from "./api/wallet.routes.js";
import bookingRoutes from "./api/booking.routes.js";
import adminRoutes from "./api/admin.routes.js";
import paymentRoutes from "./api/payment.routes.js";
import connectorRoutes from "./api/connector.routes.js";
import userRoutes from "./api/user.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.middleware.js";

const app = express();

// ============================================
// CORE MIDDLEWARE
// ============================================

// CORS configuration
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:3006"];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

// Request ID for tracing
app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || uuidv4();
  res.setHeader("X-Request-Id", req.id);
  next();
});

// Body parsing with limits
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Request logging (minimal)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.path !== "/health") {
      // console.log(`[API] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// ============================================
// HEALTH CHECK
// ============================================

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage().heapUsed,
  });
});

// Detailed health check
app.get("/health/detailed", async (req, res) => {
  const checks = {
    server: "healthy",
    database: "unknown",
    redis: "unknown",
  };

  // Check database
  try {
    const prisma = (await import("./config/db.js")).default;
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "healthy";
  } catch (err) {
    checks.database = "unhealthy";
  }

  // Check Redis
  try {
    const { redis } = await import("./config/redis.js");
    await redis.ping();
    checks.redis = "healthy";
  } catch (err) {
    checks.redis = "unhealthy";
  }

  const allHealthy = Object.values(checks).every((s) => s === "healthy");

  res.status(allHealthy ? 200 : 503).json({
    success: allHealthy,
    status: allHealthy ? "healthy" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// API ROUTES
// ============================================

app.use("/api/chargers", chargerRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/connectors", connectorRoutes);
app.use("/api/user", userRoutes);
app.use("/api", adminRoutes);

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler (must be after routes)
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

export default app;
