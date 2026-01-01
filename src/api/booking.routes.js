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

// All booking routes require authentication (when implemented)
// router.use(authMiddleware);

// POST /api/bookings - Create a new booking
router.post("/",  createBooking);

// GET /api/bookings - Get user's bookings
router.get("/", getUserBookings);

// GET /api/bookings/:bookingId - Get booking details
router.get("/:bookingId", getBookingDetails);

// DELETE /api/bookings/:bookingId - Cancel a booking
router.delete("/:bookingId", cancelBooking);

// GET /api/bookings/availability/:chargerId/:connectorId - Check connector availability
router.get("/availability/:chargerId/:connectorId", getConnectorAvailability);

export default router;

