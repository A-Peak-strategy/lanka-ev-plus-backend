import { ErrorCode } from "./ocppConstants.js";

/**
 * OCPP 1.6 Message Schema Validator
 * 
 * Validates incoming OCPP messages against expected schema.
 * Returns validation errors in OCPP-compatible format.
 */

// Schema definitions for each action
const SCHEMAS = {
  BootNotification: {
    required: ["chargePointVendor", "chargePointModel"],
    optional: [
      "chargeBoxSerialNumber",
      "chargePointSerialNumber",
      "firmwareVersion",
      "iccid",
      "imsi",
      "meterSerialNumber",
      "meterType",
    ],
    types: {
      chargePointVendor: "string",
      chargePointModel: "string",
    },
  },

  Heartbeat: {
    required: [],
    optional: [],
  },

  StatusNotification: {
    required: ["connectorId", "errorCode", "status"],
    optional: ["info", "timestamp", "vendorId", "vendorErrorCode"],
    types: {
      connectorId: "number",
      errorCode: "string",
      status: "string",
    },
    enums: {
      status: [
        "Available",
        "Preparing",
        "Charging",
        "SuspendedEVSE",
        "SuspendedEV",
        "Finishing",
        "Reserved",
        "Unavailable",
        "Faulted",
      ],
      errorCode: [
        "ConnectorLockFailure",
        "EVCommunicationError",
        "GroundFailure",
        "HighTemperature",
        "InternalError",
        "LocalListConflict",
        "NoError",
        "OtherError",
        "OverCurrentFailure",
        "OverVoltage",
        "PowerMeterFailure",
        "PowerSwitchFailure",
        "ReaderFailure",
        "ResetFailure",
        "UnderVoltage",
        "WeakSignal",
      ],
    },
  },

  Authorize: {
    required: ["idTag"],
    optional: [],
    types: {
      idTag: "string",
    },
    constraints: {
      idTag: { maxLength: 20 },
    },
  },

  StartTransaction: {
    required: ["connectorId", "idTag", "meterStart", "timestamp"],
    optional: ["reservationId"],
    types: {
      connectorId: "number",
      idTag: "string",
      meterStart: "number",
      timestamp: "string",
      reservationId: "number",
    },
    constraints: {
      connectorId: { min: 1 },
      idTag: { maxLength: 20 },
      meterStart: { min: 0 },
    },
  },

  StopTransaction: {
    required: ["meterStop", "timestamp", "transactionId"],
    optional: ["idTag", "reason", "transactionData"],
    types: {
      meterStop: "number",
      timestamp: "string",
      transactionId: "number",
      idTag: "string",
      reason: "string",
    },
    enums: {
      reason: [
        "EmergencyStop",
        "EVDisconnected",
        "HardReset",
        "Local",
        "Other",
        "PowerLoss",
        "Reboot",
        "Remote",
        "SoftReset",
        "UnlockCommand",
        "DeAuthorized",
      ],
    },
  },

  MeterValues: {
    required: ["connectorId", "meterValue"],
    optional: ["transactionId"],
    types: {
      connectorId: "number",
      transactionId: "number",
    },
    constraints: {
      connectorId: { min: 0 },
    },
  },

  DataTransfer: {
    required: ["vendorId"],
    optional: ["messageId", "data"],
    types: {
      vendorId: "string",
      messageId: "string",
      data: "string",
    },
  },
};

/**
 * Validate an OCPP message payload against its schema
 * 
 * @param {string} action - OCPP action name
 * @param {object} payload - Message payload
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function validatePayload(action, payload) {
  const schema = SCHEMAS[action];
  
  if (!schema) {
    // Unknown action - allow but log
    console.warn(`[OCPP] No schema defined for action: ${action}`);
    return { valid: true, errors: [] };
  }

  const errors = [];

  // Check required fields
  for (const field of schema.required) {
    if (payload[field] === undefined || payload[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check types
  if (schema.types) {
    for (const [field, expectedType] of Object.entries(schema.types)) {
      const value = payload[field];
      if (value !== undefined && value !== null) {
        if (!checkType(value, expectedType)) {
          errors.push(`Field '${field}' should be ${expectedType}, got ${typeof value}`);
        }
      }
    }
  }

  // Check enums
  if (schema.enums) {
    for (const [field, validValues] of Object.entries(schema.enums)) {
      const value = payload[field];
      if (value !== undefined && value !== null && !validValues.includes(value)) {
        errors.push(`Field '${field}' has invalid value '${value}'`);
      }
    }
  }

  // Check constraints
  if (schema.constraints) {
    for (const [field, constraints] of Object.entries(schema.constraints)) {
      const value = payload[field];
      if (value !== undefined && value !== null) {
        if (constraints.min !== undefined && value < constraints.min) {
          errors.push(`Field '${field}' must be >= ${constraints.min}`);
        }
        if (constraints.max !== undefined && value > constraints.max) {
          errors.push(`Field '${field}' must be <= ${constraints.max}`);
        }
        if (constraints.maxLength !== undefined && typeof value === "string" && value.length > constraints.maxLength) {
          errors.push(`Field '${field}' exceeds max length of ${constraints.maxLength}`);
        }
      }
    }
  }

  // Check for unknown fields (warning only)
  const allKnownFields = [...(schema.required || []), ...(schema.optional || [])];
  for (const field of Object.keys(payload)) {
    if (!allKnownFields.includes(field)) {
      // Just log, don't fail - OCPP allows vendor extensions
      console.debug(`[OCPP] Unknown field in ${action}: ${field}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    errorCode: errors.length > 0 ? ErrorCode.FORMATION_VIOLATION : null,
  };
}

/**
 * Check if value matches expected type
 */
function checkType(value, expectedType) {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && !Array.isArray(value);
    default:
      return true;
  }
}

/**
 * Validate OCPP message structure
 * 
 * @param {array} message - Raw OCPP message
 * @returns {object} Validation result
 */
export function validateMessageStructure(message) {
  if (!Array.isArray(message)) {
    return {
      valid: false,
      error: "Message must be an array",
      errorCode: ErrorCode.FORMATION_VIOLATION,
    };
  }

  if (message.length < 3) {
    return {
      valid: false,
      error: "Message too short",
      errorCode: ErrorCode.FORMATION_VIOLATION,
    };
  }

  const [messageType, messageId] = message;

  // Validate message type
  if (![2, 3, 4].includes(messageType)) {
    return {
      valid: false,
      error: `Invalid message type: ${messageType}`,
      errorCode: ErrorCode.PROTOCOL_ERROR,
    };
  }

  // Validate message ID
  if (typeof messageId !== "string" || messageId.length === 0) {
    return {
      valid: false,
      error: "Invalid message ID",
      errorCode: ErrorCode.FORMATION_VIOLATION,
    };
  }

  // CALL message should have 4 elements
  if (messageType === 2 && message.length < 4) {
    return {
      valid: false,
      error: "CALL message requires action and payload",
      errorCode: ErrorCode.FORMATION_VIOLATION,
    };
  }

  return { valid: true };
}

export default {
  validatePayload,
  validateMessageStructure,
};

