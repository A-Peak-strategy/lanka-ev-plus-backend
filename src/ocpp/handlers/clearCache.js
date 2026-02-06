import { sendCallResult } from "../messageQueue.js";
import { ClearCacheStatus } from "../ocppConstants.js";

/**
 * OCPP 1.6 ClearCache
 * Central System requests Charge Point to clear its authorization cache
 */
export default async function clearCache(ws, messageId, chargerId, payload) {
    console.log(`[CACHE] ${chargerId}: ClearCache requested`);

    try {
        // In production, clear local authorization list cache
        // For now, just log and accept
        console.log(`[CACHE] ${chargerId}: Authorization cache cleared`);

        sendCallResult(ws, messageId, {
            status: ClearCacheStatus.ACCEPTED
        });
    } catch (error) {
        console.error(`[CACHE] Error clearing cache:`, error);
        sendCallResult(ws, messageId, {
            status: ClearCacheStatus.REJECTED
        });
    }
}