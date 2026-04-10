
export function createBookingSuccessResponse(bookingDto) {
  return {
    success: true,
    booking: bookingDto,
  };
}

export function createBookingErrorResponse(message, errorCode = 'BOOKING_FAILED') {
  return {
    success: false,
    message,
    errorCode,
  };
}
