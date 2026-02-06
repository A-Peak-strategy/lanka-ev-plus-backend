import { sendCallResult } from "../messageQueue.js";

export default async function unlockConnector(
    ws,
    messageId,
    chargerId,
    payload
) {
    console.log(`[UNLOCK] ${chargerId}:`, payload.connectorId);
    sendCallResult(ws, messageId, {});
}
