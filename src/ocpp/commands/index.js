/**
 * OCPP Commands (Central System → Charge Point)
 * 
 * This module exports all available OCPP commands that can be sent
 * from the Central System to Charge Points.
 */

export { 
  remoteStartTransaction, 
  startChargingForUser 
} from "./remoteStartTransaction.js";

export { 
  remoteStopTransaction, 
  stopChargingAtCharger,
  forceStopForGrace 
} from "./remoteStopTransaction.js";

export { 
  reserveNow, 
  createBookingWithReservation 
} from "./reserveNow.js";

export { 
  cancelReservation, 
  cancelBooking,
  cancelExpiredBookings 
} from "./cancelReservation.js";

// Re-export as default object for convenience
export default {
  // Remote Start/Stop
  remoteStartTransaction: (...args) => import("./remoteStartTransaction.js").then(m => m.remoteStartTransaction(...args)),
  remoteStopTransaction: (...args) => import("./remoteStopTransaction.js").then(m => m.remoteStopTransaction(...args)),
  startChargingForUser: (...args) => import("./remoteStartTransaction.js").then(m => m.startChargingForUser(...args)),
  stopChargingAtCharger: (...args) => import("./remoteStopTransaction.js").then(m => m.stopChargingAtCharger(...args)),
  
  // Reservations
  reserveNow: (...args) => import("./reserveNow.js").then(m => m.reserveNow(...args)),
  cancelReservation: (...args) => import("./cancelReservation.js").then(m => m.cancelReservation(...args)),
  createBookingWithReservation: (...args) => import("./reserveNow.js").then(m => m.createBookingWithReservation(...args)),
  cancelBooking: (...args) => import("./cancelReservation.js").then(m => m.cancelBooking(...args)),
};

