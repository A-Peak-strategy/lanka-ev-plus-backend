
export function mapBookingToDTO(booking, connector, charger, station) {
  return {
    id: booking.id,
    connectorId: connector.id,
    startTime: booking.startTime.toISOString(),
    expiryTime: booking.expiryTime.toISOString(),
    status: booking.status,
    charger: {
      id: charger.id,
      station: station?.name ?? '',
    },
  };
}
