import { sendCallResult } from "../messageQueue.js";

export default async function clearChargingProfile(
    ws,
    messageId,
    chargerId,
    payload
) {
    console.log(`[CLEAR_CHARGING_PROFILE] ${chargerId}:`, payload);
    sendCallResult(ws, messageId, {});
}
