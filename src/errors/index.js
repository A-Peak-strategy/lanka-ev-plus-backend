/**
 * Domain-Specific Error Classes
 * 
 * Provides structured error types for consistent error handling across the system.
 * Each error includes:
 * - HTTP status code
 * - Error code for client identification
 * - Human-readable message
 * - Optional metadata for debugging
 */

/**
 * Base application error
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = "INTERNAL_ERROR", metadata = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.metadata = metadata;
    this.isOperational = true; // Indicates expected error (not bug)
    
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      errorCode: this.errorCode,
      message: this.message,
      ...(process.env.NODE_ENV === "development" && {
        stack: this.stack,
        metadata: this.metadata,
      }),
    };
  }
}

/**
 * Authentication errors (401)
 */
export class AuthenticationError extends AppError {
  constructor(message = "Authentication required", errorCode = "AUTH_REQUIRED") {
    super(message, 401, errorCode);
  }
}

export class TokenExpiredError extends AuthenticationError {
  constructor() {
    super("Token has expired", "TOKEN_EXPIRED");
  }
}

export class InvalidTokenError extends AuthenticationError {
  constructor() {
    super("Invalid authentication token", "INVALID_TOKEN");
  }
}

/**
 * Authorization errors (403)
 */
export class AuthorizationError extends AppError {
  constructor(message = "Access denied", errorCode = "ACCESS_DENIED") {
    super(message, 403, errorCode);
  }
}

export class InsufficientRoleError extends AuthorizationError {
  constructor(requiredRole) {
    super(`Requires ${requiredRole} role`, "INSUFFICIENT_ROLE");
    this.metadata = { requiredRole };
  }
}

/**
 * Validation errors (400)
 */
export class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, "VALIDATION_ERROR", { field });
    this.field = field;
  }
}

export class MissingParameterError extends ValidationError {
  constructor(parameter) {
    super(`Missing required parameter: ${parameter}`, parameter);
    this.errorCode = "MISSING_PARAMETER";
  }
}

export class InvalidParameterError extends ValidationError {
  constructor(parameter, reason) {
    super(`Invalid ${parameter}: ${reason}`, parameter);
    this.errorCode = "INVALID_PARAMETER";
  }
}

/**
 * Resource errors (404)
 */
export class NotFoundError extends AppError {
  constructor(resource, identifier = null) {
    super(`${resource} not found`, 404, `${resource.toUpperCase().replace(/\s+/g, "_")}_NOT_FOUND`, { identifier });
    this.resource = resource;
  }
}

/**
 * Conflict errors (409)
 */
export class ConflictError extends AppError {
  constructor(message, errorCode = "CONFLICT") {
    super(message, 409, errorCode);
  }
}

export class DuplicateError extends ConflictError {
  constructor(resource, field) {
    super(`${resource} with this ${field} already exists`, "DUPLICATE_ENTRY");
    this.metadata = { resource, field };
  }
}

/**
 * Wallet-specific errors
 */
export class WalletError extends AppError {
  constructor(message, errorCode = "WALLET_ERROR", statusCode = 400) {
    super(message, statusCode, errorCode);
  }
}

export class InsufficientBalanceError extends WalletError {
  constructor(required, available) {
    super("Insufficient wallet balance", "INSUFFICIENT_BALANCE");
    this.metadata = { required, available, shortfall: required - available };
  }
}

export class WalletNotFoundError extends WalletError {
  constructor(userId) {
    super("Wallet not found", "WALLET_NOT_FOUND", 404);
    this.metadata = { userId };
  }
}

export class ConcurrentModificationError extends WalletError {
  constructor() {
    super("Wallet was modified by another operation", "CONCURRENT_MODIFICATION", 409);
  }
}

/**
 * Booking-specific errors
 */
export class BookingError extends AppError {
  constructor(message, errorCode = "BOOKING_ERROR", statusCode = 400) {
    super(message, statusCode, errorCode);
  }
}

export class BookingConflictError extends BookingError {
  constructor(reason, conflicts = []) {
    super(reason, "BOOKING_CONFLICT", 409);
    this.metadata = { conflicts };
  }
}

export class BookingNotFoundError extends BookingError {
  constructor(bookingId) {
    super("Booking not found", "BOOKING_NOT_FOUND", 404);
    this.metadata = { bookingId };
  }
}

export class BookingDisabledError extends BookingError {
  constructor(stationId) {
    super("Booking is disabled for this station", "BOOKING_DISABLED");
    this.metadata = { stationId };
  }
}

export class BookingExpiredError extends BookingError {
  constructor(bookingId) {
    super("Booking has expired", "BOOKING_EXPIRED");
    this.metadata = { bookingId };
  }
}

/**
 * Charging session errors
 */
export class ChargingSessionError extends AppError {
  constructor(message, errorCode = "CHARGING_ERROR", statusCode = 400) {
    super(message, statusCode, errorCode);
  }
}

export class SessionNotFoundError extends ChargingSessionError {
  constructor(transactionId) {
    super("Charging session not found", "SESSION_NOT_FOUND", 404);
    this.metadata = { transactionId };
  }
}

export class SessionAlreadyActiveError extends ChargingSessionError {
  constructor(connectorId) {
    super("Connector already has an active session", "SESSION_ALREADY_ACTIVE", 409);
    this.metadata = { connectorId };
  }
}

export class ConnectorReservedError extends ChargingSessionError {
  constructor(connectorId, expiresAt) {
    super("Connector is reserved for another user", "CONNECTOR_RESERVED", 409);
    this.metadata = { connectorId, expiresAt };
  }
}

/**
 * OCPP Protocol errors
 */
export class OcppProtocolError extends AppError {
  constructor(message, errorCode = "OCPP_ERROR", statusCode = 400) {
    super(message, statusCode, errorCode);
  }
}

export class ChargerOfflineError extends OcppProtocolError {
  constructor(chargerId) {
    super("Charger is offline", "CHARGER_OFFLINE", 503);
    this.metadata = { chargerId };
  }
}

export class OcppTimeoutError extends OcppProtocolError {
  constructor(action, chargerId) {
    super(`OCPP request timed out: ${action}`, "OCPP_TIMEOUT", 504);
    this.metadata = { action, chargerId };
  }
}

export class InvalidOcppMessageError extends OcppProtocolError {
  constructor(reason) {
    super(`Invalid OCPP message: ${reason}`, "INVALID_OCPP_MESSAGE");
  }
}

/**
 * Rate limiting error
 */
export class RateLimitError extends AppError {
  constructor(retryAfter = 60) {
    super("Too many requests", 429, "RATE_LIMIT_EXCEEDED");
    this.metadata = { retryAfter };
  }
}

/**
 * Check if error is operational (expected) vs programming error
 */
export function isOperationalError(error) {
  return error instanceof AppError && error.isOperational;
}

export default {
  AppError,
  AuthenticationError,
  TokenExpiredError,
  InvalidTokenError,
  AuthorizationError,
  InsufficientRoleError,
  ValidationError,
  MissingParameterError,
  InvalidParameterError,
  NotFoundError,
  ConflictError,
  DuplicateError,
  WalletError,
  InsufficientBalanceError,
  WalletNotFoundError,
  ConcurrentModificationError,
  BookingError,
  BookingConflictError,
  BookingNotFoundError,
  BookingDisabledError,
  BookingExpiredError,
  ChargingSessionError,
  SessionNotFoundError,
  SessionAlreadyActiveError,
  ConnectorReservedError,
  OcppProtocolError,
  ChargerOfflineError,
  OcppTimeoutError,
  InvalidOcppMessageError,
  RateLimitError,
  isOperationalError,
};

