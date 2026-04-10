import { MissingParameterError, InvalidParameterError, ValidationError } from "../errors/index.js";

/**
 * Input Validation Utilities
 * 
 * Provides consistent validation across API endpoints and services.
 */

/**
 * Validate that a required parameter exists
 */
export function requireParam(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new MissingParameterError(name);
  }
  return value;
}

/**
 * Validate UUID format
 */
export function validateUUID(value, name) {
  if (!value) return null;
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new InvalidParameterError(name, "must be a valid UUID");
  }
  return value;
}

/**
 * Validate positive number
 */
export function validatePositiveNumber(value, name) {
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new InvalidParameterError(name, "must be a number");
  }
  if (num < 0) {
    throw new InvalidParameterError(name, "must be positive");
  }
  return num;
}

/**
 * Validate integer
 */
export function validateInteger(value, name) {
  const num = parseInt(value);
  if (isNaN(num)) {
    throw new InvalidParameterError(name, "must be an integer");
  }
  return num;
}

/**
 * Validate email format
 */
export function validateEmail(value, name = "email") {
  if (!value) return null;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    throw new InvalidParameterError(name, "must be a valid email address");
  }
  return value.toLowerCase();
}

/**
 * Validate phone number
 */
export function validatePhone(value, name = "phone") {
  if (!value) return null;
  
  // Allow + and digits only
  const phoneRegex = /^\+?[0-9]{7,15}$/;
  if (!phoneRegex.test(value.replace(/[\s-]/g, ""))) {
    throw new InvalidParameterError(name, "must be a valid phone number");
  }
  return value.replace(/[\s-]/g, "");
}

/**
 * Validate date/datetime
 */
export function validateDate(value, name) {
  if (!value) return null;
  
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new InvalidParameterError(name, "must be a valid date");
  }
  return date;
}

/**
 * Validate future date
 */
export function validateFutureDate(value, name) {
  const date = validateDate(value, name);
  if (!date) return null;
  
  if (date <= new Date()) {
    throw new InvalidParameterError(name, "must be in the future");
  }
  return date;
}

/**
 * Validate enum value
 */
export function validateEnum(value, validValues, name) {
  if (!value) return null;
  
  if (!validValues.includes(value)) {
    throw new InvalidParameterError(
      name,
      `must be one of: ${validValues.join(", ")}`
    );
  }
  return value;
}

/**
 * Validate charger ID format
 */
export function validateChargerId(value, name = "chargerId") {
  if (!value) {
    throw new MissingParameterError(name);
  }
  
  // Allow alphanumeric, underscore, hyphen
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new InvalidParameterError(name, "contains invalid characters");
  }
  
  if (value.length > 50) {
    throw new InvalidParameterError(name, "exceeds maximum length of 50");
  }
  
  return value;
}

/**
 * Validate connector ID (1-based positive integer)
 */
export function validateConnectorId(value, name = "connectorId") {
  const connId = validateInteger(value, name);
  
  if (connId < 0) {
    throw new InvalidParameterError(name, "must be 0 or greater");
  }
  
  return connId;
}

/**
 * Validate station ID
 */
export function validateStationId(value, name = "stationId") {
  return validateUUID(value, name);
}

/**
 * Validate decimal amount (money)
 */
export function validateAmount(value, name = "amount") {
  const num = parseFloat(value);
  
  if (isNaN(num)) {
    throw new InvalidParameterError(name, "must be a valid amount");
  }
  
  if (num < 0) {
    throw new InvalidParameterError(name, "cannot be negative");
  }
  
  // Check decimal places (max 2)
  const parts = value.toString().split(".");
  if (parts[1] && parts[1].length > 2) {
    throw new InvalidParameterError(name, "cannot have more than 2 decimal places");
  }
  
  return num.toFixed(2);
}

/**
 * Validate OCPP idTag
 */
export function validateIdTag(value, name = "idTag") {
  if (!value) return null;
  
  if (value.length > 20) {
    throw new InvalidParameterError(name, "exceeds maximum length of 20");
  }
  
  return value;
}

/**
 * Validate transaction ID
 */
export function validateTransactionId(value, name = "transactionId") {
  if (!value) {
    throw new MissingParameterError(name);
  }
  
  return value.toString();
}

/**
 * Validate multiple parameters at once
 * 
 * @example
 * validateParams(req.body, {
 *   email: { required: true, type: 'email' },
 *   amount: { required: true, type: 'positiveNumber' },
 *   date: { type: 'futureDate' }
 * });
 */
export function validateParams(data, schema) {
  const validated = {};
  const errors = [];
  
  for (const [key, rules] of Object.entries(schema)) {
    const value = data[key];
    
    try {
      if (rules.required && (value === undefined || value === null || value === "")) {
        throw new MissingParameterError(key);
      }
      
      if (value !== undefined && value !== null && value !== "") {
        switch (rules.type) {
          case "uuid":
            validated[key] = validateUUID(value, key);
            break;
          case "email":
            validated[key] = validateEmail(value, key);
            break;
          case "phone":
            validated[key] = validatePhone(value, key);
            break;
          case "positiveNumber":
            validated[key] = validatePositiveNumber(value, key);
            break;
          case "integer":
            validated[key] = validateInteger(value, key);
            break;
          case "date":
            validated[key] = validateDate(value, key);
            break;
          case "futureDate":
            validated[key] = validateFutureDate(value, key);
            break;
          case "amount":
            validated[key] = validateAmount(value, key);
            break;
          case "chargerId":
            validated[key] = validateChargerId(value, key);
            break;
          case "connectorId":
            validated[key] = validateConnectorId(value, key);
            break;
          default:
            validated[key] = value;
        }
        
        // Enum validation
        if (rules.enum && !rules.enum.includes(validated[key])) {
          throw new InvalidParameterError(key, `must be one of: ${rules.enum.join(", ")}`);
        }
        
        // Custom validation
        if (rules.validate && typeof rules.validate === "function") {
          const result = rules.validate(validated[key]);
          if (result !== true) {
            throw new InvalidParameterError(key, result || "invalid");
          }
        }
      } else if (!rules.required) {
        validated[key] = rules.default !== undefined ? rules.default : null;
      }
    } catch (err) {
      errors.push(err);
    }
  }
  
  if (errors.length > 0) {
    // Throw first error for now
    throw errors[0];
  }
  
  return validated;
}

export default {
  requireParam,
  validateUUID,
  validatePositiveNumber,
  validateInteger,
  validateEmail,
  validatePhone,
  validateDate,
  validateFutureDate,
  validateEnum,
  validateChargerId,
  validateConnectorId,
  validateStationId,
  validateAmount,
  validateIdTag,
  validateTransactionId,
  validateParams,
};

