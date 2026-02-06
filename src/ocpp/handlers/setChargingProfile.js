import { sendCallResult } from "../messageQueue.js";

export default async function setChargingProfile(
  ws,
  messageId,
  chargerId,
  payload
) {
  console.log(`[SET_CHARGING_PROFILE] ${chargerId}:`, payload);
  sendCallResult(ws, messageId, {});
}
