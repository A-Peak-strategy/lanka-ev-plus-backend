import { sendCallResult } from "../messageQueue.js";

export default async function sendLocalList(
  ws,
  messageId,
  chargerId,
  payload
) {
  console.log(`[SEND_LOCAL_LIST] ${chargerId}:`, payload);
  sendCallResult(ws, messageId, {});
}
