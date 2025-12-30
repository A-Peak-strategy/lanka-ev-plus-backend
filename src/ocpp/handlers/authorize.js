import { sendCallResult } from "../messageQueue.js";
import { AuthorizationStatus } from "../ocppConstants.js";
import { ocppEvents } from "../ocppEvents.js";
import prisma from "../../config/db.js";

/**
 * OCPP Authorize Handler
 * 
 * Before starting a charging session, the Charge Point may send an Authorize
 * request to validate the user's RFID tag or other identifier.
 * 
 * Request: { idTag: string }
 * Response: { idTagInfo: { status: AuthorizationStatus, expiryDate?, parentIdTag? } }
 * 
 * Authorization Flow:
 * 1. Check if idTag is in local authorization list (not implemented yet)
 * 2. Check if idTag is associated with a user in the system
 * 3. Check if user has sufficient wallet balance
 * 4. Return Accepted/Blocked/Invalid
 */
export default async function authorize(ws, messageId, chargerId, payload) {
  const { idTag } = payload;

  if (!idTag) {
    sendCallResult(ws, messageId, {
      idTagInfo: {
        status: AuthorizationStatus.INVALID,
      },
    });
    return;
  }

  // Emit event
  ocppEvents.emitAuthorizationRequested(chargerId, idTag);

  // Check authorization
  const authResult = await checkAuthorization(idTag);

  console.log(`[AUTH] ${chargerId} idTag: ${idTag} -> ${authResult.status}`);

  sendCallResult(ws, messageId, {
    idTagInfo: authResult,
  });
}

/**
 * Check if an idTag is authorized
 * 
 * @param {string} idTag
 * @returns {Promise<object>} idTagInfo object
 */
async function checkAuthorization(idTag) {
  try {
    // Check if idTag is associated with a user
    // In a real system, you'd have an IdTag model linked to users
    // For now, we'll check if the idTag matches a user's ID or a known pattern

    // Special case: Accept all tags starting with "USER" for testing
    if (idTag.startsWith("USER")) {
      return {
        status: AuthorizationStatus.ACCEPTED,
        expiryDate: getExpiryDate(24), // Valid for 24 hours
      };
    }

    // Check for user by idTag (could be stored in user profile)
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: idTag },
          { firebaseUid: idTag },
        ],
      },
      include: {
        wallet: true,
      },
    });

    if (!user) {
      return {
        status: AuthorizationStatus.INVALID,
      };
    }

    // Check if user is active
    if (!user.isActive) {
      return {
        status: AuthorizationStatus.BLOCKED,
      };
    }

    // Check wallet balance (optional - allow starting with any balance)
    // In production, you might require a minimum balance
    // if (user.wallet && parseFloat(user.wallet.balance) <= 0) {
    //   return {
    //     status: AuthorizationStatus.BLOCKED,
    //   };
    // }

    // Check for concurrent transactions (if not allowed)
    const activeSessions = await prisma.chargingSession.count({
      where: {
        userId: user.id,
        endedAt: null,
      },
    });

    if (activeSessions > 0) {
      return {
        status: AuthorizationStatus.CONCURRENT_TX,
      };
    }

    return {
      status: AuthorizationStatus.ACCEPTED,
      expiryDate: getExpiryDate(24),
    };
  } catch (error) {
    console.error("Authorization check error:", error);
    // On error, reject for safety
    return {
      status: AuthorizationStatus.INVALID,
    };
  }
}

/**
 * Get expiry date for authorization
 * 
 * @param {number} hours - Hours until expiry
 * @returns {string} ISO8601 date string
 */
function getExpiryDate(hours) {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

