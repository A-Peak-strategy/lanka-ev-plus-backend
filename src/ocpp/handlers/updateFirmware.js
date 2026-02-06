import { sendCallResult } from "../messageQueue.js";

export default async function updateFirmware(
  ws,
  messageId,
  chargerId,
  payload
) {
  console.log(`[UPDATE_FIRMWARE] ${chargerId}:`, payload);
  sendCallResult(ws, messageId, {});
}
