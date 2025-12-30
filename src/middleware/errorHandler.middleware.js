import { AppError, isOperationalError } from "../errors/index.js";

/**
 * Global Error Handler Middleware
 * 
 * Provides consistent error response format across all API endpoints.
 * Distinguishes between operational errors (expected) and programming errors (bugs).
 */

/**
 * Main error handler
 */
export function errorHandler(err, req, res, next) {
  // Default error values
  let statusCode = err.statusCode || 500;
  let errorCode = err.errorCode || "INTERNAL_ERROR";
  let message = err.message || "An unexpected error occurred";

  // Log error
  logError(err, req);

  // Handle specific error types
  if (err.name === "ValidationError" && err.errors) {
    // Mongoose/Prisma validation error
    statusCode = 400;
    errorCode = "VALIDATION_ERROR";
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
  }

  if (err.code === "P2002") {
    // Prisma unique constraint violation
    statusCode = 409;
    errorCode = "DUPLICATE_ENTRY";
    const field = err.meta?.target?.[0] || "field";
    message = `A record with this ${field} already exists`;
  }

  if (err.code === "P2025") {
    // Prisma record not found
    statusCode = 404;
    errorCode = "NOT_FOUND";
    message = err.meta?.cause || "Record not found";
  }

  if (err.code === "P2003") {
    // Prisma foreign key constraint
    statusCode = 400;
    errorCode = "FOREIGN_KEY_ERROR";
    message = "Related record not found";
  }

  if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    errorCode = "INVALID_TOKEN";
    message = "Invalid authentication token";
  }

  if (err.name === "TokenExpiredError") {
    statusCode = 401;
    errorCode = "TOKEN_EXPIRED";
    message = "Authentication token has expired";
  }

  // Build response
  const response = {
    success: false,
    errorCode,
    message,
  };

  // Add debug info in development
  if (process.env.NODE_ENV === "development") {
    response.stack = err.stack;
    response.metadata = err.metadata || {};
  }

  // Add request ID if available
  if (req.id) {
    response.requestId = req.id;
  }

  // Send response
  res.status(statusCode).json(response);
}

/**
 * Not found handler (404)
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    errorCode: "ENDPOINT_NOT_FOUND",
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Async handler wrapper
 * 
 * Wraps async route handlers to catch errors and forward to error handler.
 * 
 * Usage:
 *   router.get('/route', asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Error logging
 */
function logError(err, req) {
  const isOperational = isOperationalError(err);
  const logLevel = isOperational ? "warn" : "error";

  const logData = {
    timestamp: new Date().toISOString(),
    level: logLevel,
    message: err.message,
    errorCode: err.errorCode,
    statusCode: err.statusCode,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    isOperational,
  };

  if (!isOperational) {
    // Log full stack for unexpected errors
    logData.stack = err.stack;
    logData.body = req.body;
    logData.params = req.params;
    logData.query = req.query;
  }

  console[logLevel](`[${logData.level.toUpperCase()}]`, JSON.stringify(logData, null, 2));

  // In production, you might want to:
  // - Send to error tracking service (Sentry, etc.)
  // - Alert on-call if critical
  // - Record in database for analysis
}

/**
 * Unhandled rejection handler
 */
export function setupUnhandledRejectionHandler() {
  process.on("unhandledRejection", (reason, promise) => {
    console.error("[FATAL] Unhandled Rejection:", reason);
    console.error("Promise:", promise);
    
    // In production, you might want to:
    // - Alert ops team
    // - Gracefully shutdown after finishing pending requests
  });

  process.on("uncaughtException", (error) => {
    console.error("[FATAL] Uncaught Exception:", error);
    
    // Exit process in production - let process manager restart
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  });
}

export default {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  setupUnhandledRejectionHandler,
};

