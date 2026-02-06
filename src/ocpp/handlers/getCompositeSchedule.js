import { sendCallResult } from "../messageQueue.js";

export default async function getCompositeSchedule(
  ws,
  messageId,
  chargerId,
  payload
) {
  console.log(`[GET_COMPOSITE_SCHEDULE] ${chargerId}:`, payload);
  sendCallResult(ws, messageId, {});
}
