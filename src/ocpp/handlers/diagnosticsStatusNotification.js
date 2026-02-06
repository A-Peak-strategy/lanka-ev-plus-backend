import { sendCallResult } from "../messageQueue.js";

export default async function diagnosticsStatusNotification(
    ws,
    messageId,
    chargerId,
    payload
) {
    console.log(`[DIAGNOSTICS] ${chargerId}:`, payload.status);

    sendCallResult(ws, messageId, {});
}
