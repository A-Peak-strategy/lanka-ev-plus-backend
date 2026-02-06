import { sendCallResult } from "../messageQueue.js";

export default async function reset(
  ws,
  messageId,
  chargerId,
  payload
) {
  console.log(`[RESET] ${chargerId}:`, payload);
  sendCallResult(ws, messageId, {});
}
