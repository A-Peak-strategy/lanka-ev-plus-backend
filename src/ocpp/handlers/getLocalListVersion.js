import { sendCallResult } from "../messageQueue.js";

export default async function getLocalListVersion(
  ws,
  messageId,
  chargerId,
  payload
) {
  console.log(`[GET_LOCAL_LIST_VERSION] ${chargerId}:`, payload);
  sendCallResult(ws, messageId, {});
}
