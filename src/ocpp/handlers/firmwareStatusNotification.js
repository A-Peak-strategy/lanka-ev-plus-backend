import { sendCallResult } from "../messageQueue.js";

export default async function firmwareStatusNotification(
    ws,
    messageId,
    chargerId,
    payload
) {
    console.log(`[FIRMWARE] ${chargerId}:`, payload.status);
    sendCallResult(ws, messageId, {});
}
