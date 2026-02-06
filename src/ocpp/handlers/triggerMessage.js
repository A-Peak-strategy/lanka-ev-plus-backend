import { sendCallResult } from "../messageQueue.js";

export default async function triggerMessage(
    ws,
    messageId,
    chargerId,
    payload
) {
    console.log(`[TRIGGER_MESSAGE] ${chargerId}:`, payload);
    sendCallResult(ws, messageId, {});
}
