import { sendCallResult } from "../messageQueue.js";

export default async function changeAvailability(
    ws,
    messageId,
    chargerId,
    payload
) {
    console.log(`[CHANGE_AVAILABILITY] ${chargerId}:`, payload);
    sendCallResult(ws, messageId, {});
}
