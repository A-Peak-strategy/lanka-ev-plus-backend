/**
 * OCPP 1.6 Constants and Enums
 * Reference: OCPP 1.6 Edition 2 Specification
 */

// OCPP Message Types
export const MessageType = {
  CALL: 2,        // Request from client to server or server to client
  CALLRESULT: 3,  // Response to a CALL
  CALLERROR: 4,   // Error response to a CALL
};

// OCPP Error Codes
export const ErrorCode = {
  NOT_IMPLEMENTED: "NotImplemented",
  NOT_SUPPORTED: "NotSupported",
  INTERNAL_ERROR: "InternalError",
  PROTOCOL_ERROR: "ProtocolError",
  SECURITY_ERROR: "SecurityError",
  FORMATION_VIOLATION: "FormationViolation",
  PROPERTY_CONSTRAINT_VIOLATION: "PropertyConstraintViolation",
  OCCURRENCE_CONSTRAINT_VIOLATION: "OccurrenceConstraintViolation",
  TYPE_CONSTRAINT_VIOLATION: "TypeConstraintViolation",
  GENERIC_ERROR: "GenericError",
};

// Charge Point Status (StatusNotification)
export const ChargePointStatus = {
  AVAILABLE: "Available",
  PREPARING: "Preparing",
  CHARGING: "Charging",
  SUSPENDED_EVSE: "SuspendedEVSE",
  SUSPENDED_EV: "SuspendedEV",
  FINISHING: "Finishing",
  RESERVED: "Reserved",
  UNAVAILABLE: "Unavailable",
  FAULTED: "Faulted",
};

// Charge Point Error Codes
export const ChargePointErrorCode = {
  CONNECTOR_LOCK_FAILURE: "ConnectorLockFailure",
  EV_COMMUNICATION_ERROR: "EVCommunicationError",
  GROUND_FAILURE: "GroundFailure",
  HIGH_TEMPERATURE: "HighTemperature",
  INTERNAL_ERROR: "InternalError",
  LOCAL_LIST_CONFLICT: "LocalListConflict",
  NO_ERROR: "NoError",
  OTHER_ERROR: "OtherError",
  OVER_CURRENT_FAILURE: "OverCurrentFailure",
  POWER_METER_FAILURE: "PowerMeterFailure",
  POWER_SWITCH_FAILURE: "PowerSwitchFailure",
  READER_FAILURE: "ReaderFailure",
  RESET_FAILURE: "ResetFailure",
  UNDER_VOLTAGE: "UnderVoltage",
  OVER_VOLTAGE: "OverVoltage",
  WEAK_SIGNAL: "WeakSignal",
};

// Authorization Status
export const AuthorizationStatus = {
  ACCEPTED: "Accepted",
  BLOCKED: "Blocked",
  EXPIRED: "Expired",
  INVALID: "Invalid",
  CONCURRENT_TX: "ConcurrentTx",
};

// Registration Status (BootNotification response)
export const RegistrationStatus = {
  ACCEPTED: "Accepted",
  PENDING: "Pending",
  REJECTED: "Rejected",
};

// Remote Start/Stop Status
export const RemoteStartStopStatus = {
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

// Reservation Status
export const ReservationStatus = {
  ACCEPTED: "Accepted",
  FAULTED: "Faulted",
  OCCUPIED: "Occupied",
  REJECTED: "Rejected",
  UNAVAILABLE: "Unavailable",
};

// Cancel Reservation Status
export const CancelReservationStatus = {
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

// Reset Type
export const ResetType = {
  HARD: "Hard",
  SOFT: "Soft",
};

// Reset Status
export const ResetStatus = {
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

// Unlock Status
export const UnlockStatus = {
  UNLOCKED: "Unlocked",
  UNLOCK_FAILED: "UnlockFailed",
  NOT_SUPPORTED: "NotSupported",
};

// Stop Transaction Reason
export const StopReason = {
  EMERGENCY_STOP: "EmergencyStop",
  EV_DISCONNECTED: "EVDisconnected",
  HARD_RESET: "HardReset",
  LOCAL: "Local",
  OTHER: "Other",
  POWER_LOSS: "PowerLoss",
  REBOOT: "Reboot",
  REMOTE: "Remote",
  SOFT_RESET: "SoftReset",
  UNLOCK_COMMAND: "UnlockCommand",
  DE_AUTHORIZED: "DeAuthorized",
};

// Measurand types for MeterValues
export const Measurand = {
  ENERGY_ACTIVE_IMPORT_REGISTER: "Energy.Active.Import.Register",
  ENERGY_ACTIVE_EXPORT_REGISTER: "Energy.Active.Export.Register",
  ENERGY_REACTIVE_IMPORT_REGISTER: "Energy.Reactive.Import.Register",
  ENERGY_REACTIVE_EXPORT_REGISTER: "Energy.Reactive.Export.Register",
  ENERGY_ACTIVE_IMPORT_INTERVAL: "Energy.Active.Import.Interval",
  ENERGY_ACTIVE_EXPORT_INTERVAL: "Energy.Active.Export.Interval",
  POWER_ACTIVE_IMPORT: "Power.Active.Import",
  POWER_ACTIVE_EXPORT: "Power.Active.Export",
  POWER_REACTIVE_IMPORT: "Power.Reactive.Import",
  POWER_REACTIVE_EXPORT: "Power.Reactive.Export",
  CURRENT_IMPORT: "Current.Import",
  CURRENT_EXPORT: "Current.Export",
  CURRENT_OFFERED: "Current.Offered",
  VOLTAGE: "Voltage",
  FREQUENCY: "Frequency",
  TEMPERATURE: "Temperature",
  SOC: "SoC",
  RPM: "RPM",
};

// OCPP Actions (Charge Point → Central System)
export const CPtoCSAction = {
  AUTHORIZE: "Authorize",
  BOOT_NOTIFICATION: "BootNotification",
  DATA_TRANSFER: "DataTransfer",
  DIAGNOSTICS_STATUS_NOTIFICATION: "DiagnosticsStatusNotification",
  FIRMWARE_STATUS_NOTIFICATION: "FirmwareStatusNotification",
  HEARTBEAT: "Heartbeat",
  METER_VALUES: "MeterValues",
  START_TRANSACTION: "StartTransaction",
  STATUS_NOTIFICATION: "StatusNotification",
  STOP_TRANSACTION: "StopTransaction",
};

// OCPP Actions (Central System → Charge Point)
export const CStoCPAction = {
  CANCEL_RESERVATION: "CancelReservation",
  CHANGE_AVAILABILITY: "ChangeAvailability",
  CHANGE_CONFIGURATION: "ChangeConfiguration",
  CLEAR_CACHE: "ClearCache",
  CLEAR_CHARGING_PROFILE: "ClearChargingProfile",
  DATA_TRANSFER: "DataTransfer",
  GET_COMPOSITE_SCHEDULE: "GetCompositeSchedule",
  GET_CONFIGURATION: "GetConfiguration",
  GET_DIAGNOSTICS: "GetDiagnostics",
  GET_LOCAL_LIST_VERSION: "GetLocalListVersion",
  REMOTE_START_TRANSACTION: "RemoteStartTransaction",
  REMOTE_STOP_TRANSACTION: "RemoteStopTransaction",
  RESERVE_NOW: "ReserveNow",
  RESET: "Reset",
  SEND_LOCAL_LIST: "SendLocalList",
  SET_CHARGING_PROFILE: "SetChargingProfile",
  TRIGGER_MESSAGE: "TriggerMessage",
  UNLOCK_CONNECTOR: "UnlockConnector",
  UPDATE_FIRMWARE: "UpdateFirmware",
};

// ChangeConfiguration Status
export const ConfigurationStatus = {
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  NOT_SUPPORTED: "NotSupported",
};

// ClearCache Status
export const ClearCacheStatus = {
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};


// Availability Type
export const AvailabilityType = {
  INOPERATIVE: "Inoperative",
  OPERATIVE: "Operative",
};

// Availability Status
export const AvailabilityStatus = {
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  SCHEDULED: "Scheduled",
};

// Trigger Message Status
export const TriggerMessageStatus = {
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  NOT_IMPLEMENTED: "NotImplemented",
};

// Message Trigger
export const MessageTrigger = {
  BOOT_NOTIFICATION: "BootNotification",
  DIAGNOSTICS_STATUS_NOTIFICATION: "DiagnosticsStatusNotification",
  FIRMWARE_STATUS_NOTIFICATION: "FirmwareStatusNotification",
  HEARTBEAT: "Heartbeat",
  METER_VALUES: "MeterValues",
  STATUS_NOTIFICATION: "StatusNotification",
};

// Charging Profile Purpose Type
export const ChargingProfilePurposeType = {
  CHARGE_POINT_MAX_PROFILE: "ChargePointMaxProfile",
  TX_DEFAULT_PROFILE: "TxDefaultProfile",
  TX_PROFILE: "TxProfile",
};

// Charging Profile Status
export const ChargingProfileStatus = {
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  NOT_SUPPORTED: "NotSupported",
};

// Composite Schedule Status
export const CompositeScheduleStatus = {
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};


export default {
  MessageType,
  ErrorCode,
  ChargePointStatus,
  ChargePointErrorCode,
  AuthorizationStatus,
  RegistrationStatus,
  RemoteStartStopStatus,
  ReservationStatus,
  CancelReservationStatus,
  ResetType,
  ResetStatus,
  UnlockStatus,
  StopReason,
  Measurand,
  ConfigurationStatus,
  ClearCacheStatus,
  CPtoCSAction,
  CStoCPAction,
  AvailabilityType,
  AvailabilityStatus,
  TriggerMessageStatus,
  MessageTrigger,
  ChargingProfilePurposeType,
  ChargingProfileStatus,
  CompositeScheduleStatus,
};

