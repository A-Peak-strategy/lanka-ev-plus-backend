import { getMessaging } from "../config/firebase.js";
import prisma from "../config/db.js";

/**
 * Notification Service
 * 
 * Handles Firebase Cloud Messaging (FCM) push notifications.
 * 
 * Notification types:
 * - LOW_BALANCE: Wallet balance is running low
 * - GRACE_STARTED: Grace period has started
 * - GRACE_CANCELLED: Grace period was cancelled (topped up)
 * - CHARGING_STOPPED: Charging was force-stopped
 * - CHARGING_COMPLETE: Normal charging completion
 */

// Notification types
export const NotificationType = {
  LOW_BALANCE: "LOW_BALANCE",
  GRACE_STARTED: "GRACE_STARTED",
  GRACE_CANCELLED: "GRACE_CANCELLED",
  CHARGING_STOPPED: "CHARGING_STOPPED",
  CHARGING_COMPLETE: "CHARGING_COMPLETE",
  TOP_UP_SUCCESS: "TOP_UP_SUCCESS",
};

/**
 * Get FCM token for a user
 * 
 * In production, you'd store FCM tokens in the database.
 * This is a placeholder that would be extended.
 * 
 * @param {string} userId
 * @returns {Promise<string|null>} FCM token
 */
async function getFcmToken(userId) {
  // TODO: Implement FCM token storage in User model
  // For now, we'll just log and return null
  // In production:
  // const user = await prisma.user.findUnique({ where: { id: userId } });
  // return user?.fcmToken;
  return null;
}

/**
 * Send push notification to a user
 * 
 * @param {string} userId - User ID
 * @param {object} notification - Notification content
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<object>} Send result
 */
export async function sendPushNotification(userId, notification, data = {}) {
  const messaging = getMessaging();

  if (!messaging) {
    console.log(`📱 [Mock] Push to ${userId}:`, notification.title);
    return { success: false, reason: "Firebase not configured" };
  }

  const fcmToken = await getFcmToken(userId);

  if (!fcmToken) {
    console.log(`📱 [No token] Push to ${userId}:`, notification.title);
    return { success: false, reason: "No FCM token for user" };
  }

  try {
    const result = await messaging.send({
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        type: data.type || "GENERAL",
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "ev_charging",
          priority: "high",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    });

    console.log(`📱 Push sent to ${userId}:`, notification.title);
    return { success: true, messageId: result };
  } catch (error) {
    console.error(`Failed to send push to ${userId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send low balance warning notification
 */
export async function sendLowBalanceWarning({
  userId,
  balance,
  threshold,
  transactionId,
}) {
  return sendPushNotification(
    userId,
    {
      title: "⚠️ Low Wallet Balance",
      body: `Your balance (LKR ${balance}) is running low. Top up to continue charging.`,
    },
    {
      type: NotificationType.LOW_BALANCE,
      balance,
      threshold,
      transactionId,
    }
  );
}

/**
 * Send grace period started notification
 */
export async function sendGracePeriodStarted({
  userId,
  transactionId,
  gracePeriodSec,
  requiredAmount,
  currentBalance,
}) {
  const minutes = Math.floor(gracePeriodSec / 60);
  const seconds = gracePeriodSec % 60;
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return sendPushNotification(
    userId,
    {
      title: "⏱️ Insufficient Balance - Grace Period Started",
      body: `You have ${timeStr} to top up your wallet or charging will stop. Required: LKR ${requiredAmount}`,
    },
    {
      type: NotificationType.GRACE_STARTED,
      transactionId,
      gracePeriodSec: gracePeriodSec.toString(),
      requiredAmount,
      currentBalance,
    }
  );
}

/**
 * Send grace period cancelled notification
 */
export async function sendGracePeriodCancelled({
  userId,
  transactionId,
  reason,
}) {
  return sendPushNotification(
    userId,
    {
      title: "✅ Charging Resumed",
      body: `Your wallet has been topped up. Charging continues normally.`,
    },
    {
      type: NotificationType.GRACE_CANCELLED,
      transactionId,
      reason,
    }
  );
}

/**
 * Send charging force-stopped notification
 */
export async function sendChargingForceStopped({
  userId,
  transactionId,
  reason,
  energyUsedWh,
  totalCost,
}) {
  const energyKwh = (energyUsedWh / 1000).toFixed(2);

  return sendPushNotification(
    userId,
    {
      title: "🔴 Charging Stopped",
      body: `Charging was stopped due to ${reason}. Energy used: ${energyKwh} kWh. Total: LKR ${totalCost}`,
    },
    {
      type: NotificationType.CHARGING_STOPPED,
      transactionId,
      reason,
      energyUsedWh: energyUsedWh.toString(),
      totalCost,
    }
  );
}

/**
 * Send charging complete notification
 */
export async function sendChargingComplete({
  userId,
  transactionId,
  energyUsedWh,
  totalCost,
  duration,
}) {
  const energyKwh = (energyUsedWh / 1000).toFixed(2);
  const durationMin = Math.round(duration / 60000);

  return sendPushNotification(
    userId,
    {
      title: "✅ Charging Complete",
      body: `Session finished. ${energyKwh} kWh in ${durationMin} min. Total: LKR ${totalCost}`,
    },
    {
      type: NotificationType.CHARGING_COMPLETE,
      transactionId,
      energyUsedWh: energyUsedWh.toString(),
      totalCost,
      durationMin: durationMin.toString(),
    }
  );
}

/**
 * Send wallet top-up success notification
 */
export async function sendTopUpSuccess({ userId, amount, newBalance }) {
  return sendPushNotification(
    userId,
    {
      title: "💰 Wallet Topped Up",
      body: `LKR ${amount} added to your wallet. New balance: LKR ${newBalance}`,
    },
    {
      type: NotificationType.TOP_UP_SUCCESS,
      amount,
      newBalance,
    }
  );
}

export default {
  NotificationType,
  sendPushNotification,
  sendLowBalanceWarning,
  sendGracePeriodStarted,
  sendGracePeriodCancelled,
  sendChargingForceStopped,
  sendChargingComplete,
  sendTopUpSuccess,
};

