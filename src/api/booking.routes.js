import express from "express";
import {
  createBooking,
  cancelBooking,
  getUserBookings,
  getBookingDetails,
  getConnectorAvailability,
} from "./booking.controller.js";
import { requireActiveUser, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// POST /api/bookings - Create a new booking
router.post("/", verifyToken, requireActiveUser, createBooking);

// GET /api/bookings - Get user's bookings
router.get("/", verifyToken, requireActiveUser, getUserBookings);

// GET /api/bookings/availability/:chargerId/:connectorId - Check connector availability
// Must be before /:bookingId to avoid "availability" being treated as a bookingId
router.get("/availability/:chargerId/:connectorId", verifyToken, requireActiveUser, getConnectorAvailability);

// GET /api/bookings/:bookingId - Get booking details (auth required)
router.get("/:bookingId", verifyToken, requireActiveUser, getBookingDetails);

// DELETE /api/bookings/:bookingId - Cancel a booking
router.delete("/:bookingId", verifyToken, requireActiveUser, cancelBooking);

export default router;

