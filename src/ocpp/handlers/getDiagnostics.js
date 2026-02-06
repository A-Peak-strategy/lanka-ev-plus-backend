import { sendCallResult } from "../messageQueue.js";

export default async function getDiagnostics(
  ws,
  messageId,
  chargerId,
  payload
) {
  console.log(`[GET_DIAGNOSTICS] ${chargerId}:`, payload);
  sendCallResult(ws, messageId, {});
}
