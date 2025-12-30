import { EventEmitter } from "events";

/**
 * OCPP Event Emitter
 * 
 * Internal event bus for OCPP-related events.
 * Allows decoupling of OCPP handlers from billing, notifications, etc.
 * 
 * Events:
 * - charger:connected - Charger WebSocket connected
 * - charger:disconnected - Charger WebSocket disconnected
 * - charger:booted - BootNotification received
 * - charger:heartbeat - Heartbeat received
 * - charger:statusChanged - Status changed
 * - session:started - Charging session started
 * - session:meterUpdate - MeterValues received
 * - session:stopped - Charging session stopped
 * - session:faulted - Charger fault during session
 * - authorization:requested - Authorize request received
 * - reservation:created - Reservation created
 * - reservation:cancelled - Reservation cancelled
 */

class OcppEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // Allow many subscribers
  }

  /**
   * Emit charger connected event
   */
  emitChargerConnected(chargerId, metadata = {}) {
    this.emit("charger:connected", {
      chargerId,
      timestamp: new Date(),
      ...metadata,
    });
  }

  /**
   * Emit charger disconnected event
   */
  emitChargerDisconnected(chargerId, metadata = {}) {
    this.emit("charger:disconnected", {
      chargerId,
      timestamp: new Date(),
      ...metadata,
    });
  }

  /**
   * Emit charger booted event
   */
  emitChargerBooted(chargerId, bootData) {
    this.emit("charger:booted", {
      chargerId,
      timestamp: new Date(),
      vendor: bootData.chargePointVendor,
      model: bootData.chargePointModel,
      serialNumber: bootData.chargePointSerialNumber,
      firmwareVersion: bootData.firmwareVersion,
    });
  }

  /**
   * Emit heartbeat event
   */
  emitHeartbeat(chargerId) {
    this.emit("charger:heartbeat", {
      chargerId,
      timestamp: new Date(),
    });
  }

  /**
   * Emit status changed event
   */
  emitStatusChanged(chargerId, connectorId, status, errorCode, info) {
    this.emit("charger:statusChanged", {
      chargerId,
      connectorId,
      status,
      errorCode,
      info,
      timestamp: new Date(),
    });
  }

  /**
   * Emit session started event
   */
  emitSessionStarted(data) {
    this.emit("session:started", {
      ...data,
      timestamp: new Date(),
    });
  }

  /**
   * Emit meter update event
   */
  emitMeterUpdate(data) {
    this.emit("session:meterUpdate", {
      ...data,
      timestamp: new Date(),
    });
  }

  /**
   * Emit session stopped event
   */
  emitSessionStopped(data) {
    this.emit("session:stopped", {
      ...data,
      timestamp: new Date(),
    });
  }

  /**
   * Emit session faulted event
   */
  emitSessionFaulted(data) {
    this.emit("session:faulted", {
      ...data,
      timestamp: new Date(),
    });
  }

  /**
   * Emit authorization requested event
   */
  emitAuthorizationRequested(chargerId, idTag) {
    this.emit("authorization:requested", {
      chargerId,
      idTag,
      timestamp: new Date(),
    });
  }

  /**
   * Emit reservation created event
   */
  emitReservationCreated(data) {
    this.emit("reservation:created", {
      ...data,
      timestamp: new Date(),
    });
  }

  /**
   * Emit reservation cancelled event
   */
  emitReservationCancelled(data) {
    this.emit("reservation:cancelled", {
      ...data,
      timestamp: new Date(),
    });
  }
}

// Singleton instance
export const ocppEvents = new OcppEventEmitter();

// Setup event listeners for billing integration
export function setupEventListeners() {
  // Log all events in development
  if (process.env.NODE_ENV === "development") {
    ocppEvents.on("charger:connected", (data) => {
      console.log(`📡 [Event] Charger connected: ${data.chargerId}`);
    });

    ocppEvents.on("charger:disconnected", (data) => {
      console.log(`📡 [Event] Charger disconnected: ${data.chargerId}`);
    });

    ocppEvents.on("session:started", (data) => {
      console.log(`📡 [Event] Session started: ${data.transactionId}`);
    });

    ocppEvents.on("session:stopped", (data) => {
      console.log(`📡 [Event] Session stopped: ${data.transactionId}`);
    });
  }

  // Billing integration
  ocppEvents.on("session:meterUpdate", async (data) => {
    try {
      const { processMeterValuesBilling } = await import("../services/billing.service.js");
      await processMeterValuesBilling({
        chargerId: data.chargerId,
        transactionId: data.transactionId,
        currentMeterWh: data.meterWh,
      });
    } catch (error) {
      console.error("Billing integration error:", error.message);
    }
  });

  // Handle faults with partial refund
  ocppEvents.on("session:faulted", async (data) => {
    try {
      const { handleSessionFault } = await import("../services/session.service.js");
      await handleSessionFault(data);
    } catch (error) {
      console.error("Session fault handling error:", error.message);
    }
  });
}

export default ocppEvents;

