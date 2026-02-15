import { sendCallResult } from "../messageQueue.js";

/**
 * OCPP DataTransfer Handler
 * 
 * DataTransfer allows vendor-specific messages to be exchanged between
 * the Charge Point and Central System.
 * 
 * Request: { vendorId: string, messageId?: string, data?: string }
 * Response: { status: "Accepted"|"Rejected"|"UnknownMessageId"|"UnknownVendorId", data?: string }
 */
export default async function dataTransfer(ws, messageId, chargerId, payload) {
  const { vendorId, messageId: vendorMessageId, data } = payload;

  console.log(`[DATA] ${chargerId} vendor: ${vendorId}, message: ${vendorMessageId}`);

  // Log the data for debugging
  if (data) {
    try {
      const parsedData = JSON.parse(data);
      console.log(`[DATA] Payload:`, parsedData);
    } catch {
      console.log(`[DATA] Payload (raw):`, data);
    }
  }

  // Handle known vendor-specific messages
  const response = await handleVendorMessage(vendorId, vendorMessageId, data, chargerId);

  sendCallResult(ws, messageId, response);
}

/**
 * Handle vendor-specific messages
 * 
 * @param {string} vendorId
 * @param {string} messageId
 * @param {string} data
 * @param {string} chargerId
 * @returns {object} Response
 */
async function handleVendorMessage(vendorId, messageId, data, chargerId) {
  // Add vendor-specific handlers here
  // Example: Handle messages from specific charger manufacturers

  switch (vendorId) {
    case "com.example.vendor":
      // Handle example vendor messages
      return {
        status: "Accepted",
        data: JSON.stringify({ received: true }),
      };

    default:
      // Accept unknown vendors but indicate it
      console.log(`[DATA] Unknown vendor: ${vendorId}`);
      return {
        status: "UnknownVendorId",
      };
  }
}

