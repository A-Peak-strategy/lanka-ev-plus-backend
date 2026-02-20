import { getRedis, checkRedisAvailable } from "../config/redis.js";

/**
 * Connector Lock Service
 * 
 * Redis-based distributed locking for connector availability.
 * Falls back to in-memory locking if Redis is unavailable.
 * Prevents double bookings and race conditions.
 * 
 * Lock Types:
 * - BOOKING: Connector reserved for a future booking
 * - CHARGING: Connector in active use
 * - RESERVED: OCPP reservation active on charger
 */

// In-memory fallback store (for development without Redis)
const memoryLocks = new Map();
const memorySlots = new Map();
let useMemoryFallback = null; // null = not checked yet

// Lock key prefixes
const LOCK_PREFIX = "connector:lock:";
const BOOKING_PREFIX = "connector:booking:";

// Lock types
export const LockType = {
  BOOKING: "BOOKING",
  CHARGING: "CHARGING",
  RESERVED: "RESERVED",
};

/**
 * Check if we should use memory fallback
 */
async function shouldUseMemoryFallback() {
  if (useMemoryFallback === null) {
    useMemoryFallback = !(await checkRedisAvailable());
    if (useMemoryFallback) {
      console.warn("⚠️ ConnectorLock: Using in-memory fallback (Redis unavailable)");
    }
  }
  return useMemoryFallback;
}

/**
 * Get lock key for a connector
 * @param {string} chargerId
 * @param {number} connectorId
 * @returns {string}
 */
function getLockKey(chargerId, connectorId) {
  return `${LOCK_PREFIX}${chargerId}:${connectorId}`;
}

/**
 * Get booking key for a connector at a specific time slot
 * @param {string} chargerId
 * @param {number} connectorId
 * @param {string} timeSlot - ISO date string (hour precision)
 * @returns {string}
 */
function getBookingSlotKey(chargerId, connectorId, timeSlot) {
  // Round to hour for slot-based booking
  const hour = new Date(timeSlot).toISOString().slice(0, 13);
  return `${BOOKING_PREFIX}${chargerId}:${connectorId}:${hour}`;
}

/**
 * Acquire a lock on a connector
 * 
 * @param {object} params
 * @param {string} params.chargerId
 * @param {number} params.connectorId
 * @param {string} params.lockType - BOOKING, CHARGING, or RESERVED
 * @param {string} params.holderId - Booking ID, transaction ID, or user ID
 * @param {number} params.ttlSeconds - Lock time-to-live
 * @returns {Promise<object>} Lock result
 */
export async function acquireLock({ chargerId, connectorId, lockType, holderId, ttlSeconds }) {
  const lockKey = getLockKey(chargerId, connectorId);

  try {
    if (await shouldUseMemoryFallback()) {
      // In-memory fallback
      const existing = memoryLocks.get(lockKey);
      if (existing && existing.expiresAt > Date.now()) {
        return {
          acquired: false,
          reason: "Lock already held",
          currentHolder: existing,
        };
      }

      memoryLocks.set(lockKey, {
        type: lockType,
        holderId,
        acquiredAt: new Date().toISOString(),
        expiresAt: Date.now() + ttlSeconds * 1000,
      });

      return {
        acquired: true,
        lockKey,
        expiresIn: ttlSeconds,
      };
    }

    // Use Redis
    const redis = getRedis();
    const lockValue = JSON.stringify({
      type: lockType,
      holderId,
      acquiredAt: new Date().toISOString(),
    });

    const result = await redis.set(lockKey, lockValue, "EX", ttlSeconds, "NX");

    if (result === "OK") {
      return {
        acquired: true,
        lockKey,
        expiresIn: ttlSeconds,
      };
    }

    // Lock already exists - check who holds it
    const existing = await redis.get(lockKey);
    const existingLock = existing ? JSON.parse(existing) : null;

    return {
      acquired: false,
      reason: "Lock already held",
      currentHolder: existingLock,
    };
  } catch (error) {
    console.error("Error acquiring connector lock:", error);
    throw error;
  }
}

/**
 * Release a lock on a connector
 * 
 * @param {string} chargerId
 * @param {number} connectorId
 * @param {string} holderId - Must match the original holder
 * @returns {Promise<object>}
 */
export async function releaseLock(chargerId, connectorId, holderId) {
  const lockKey = getLockKey(chargerId, connectorId);

  try {
    if (await shouldUseMemoryFallback()) {
      const existing = memoryLocks.get(lockKey);
      if (!existing) {
        return { released: true, reason: "Lock not found" };
      }
      if (existing.holderId !== holderId) {
        return {
          released: false,
          reason: "Lock held by different holder",
          currentHolder: existing.holderId,
        };
      }
      memoryLocks.delete(lockKey);
      return { released: true };
    }

    const redis = getRedis();
    const existing = await redis.get(lockKey);
    
    if (!existing) {
      return { released: true, reason: "Lock not found" };
    }

    const lock = JSON.parse(existing);
    
    if (lock.holderId !== holderId) {
      return {
        released: false,
        reason: "Lock held by different holder",
        currentHolder: lock.holderId,
      };
    }

    await redis.del(lockKey);
    
    return { released: true };
  } catch (error) {
    console.error("Error releasing connector lock:", error);
    throw error;
  }
}

/**
 * Force release a lock (admin only)
 * 
 * @param {string} chargerId
 * @param {number} connectorId
 * @returns {Promise<object>}
 */
export async function forceReleaseLock(chargerId, connectorId) {
  const lockKey = getLockKey(chargerId, connectorId);
  
  if (await shouldUseMemoryFallback()) {
    memoryLocks.delete(lockKey);
  } else {
    const redis = getRedis();
    await redis.del(lockKey);
  }
  
  return { released: true, forced: true };
}

/**
 * Get current lock status for a connector
 * 
 * @param {string} chargerId
 * @param {number} connectorId
 * @returns {Promise<object|null>}
 */
export async function getLockStatus(chargerId, connectorId) {
  const lockKey = getLockKey(chargerId, connectorId);

  if (await shouldUseMemoryFallback()) {
    const existing = memoryLocks.get(lockKey);
    if (!existing || existing.expiresAt <= Date.now()) {
      memoryLocks.delete(lockKey);
      return null;
    }
    return {
      ...existing,
      lockKey,
      ttlSeconds: Math.floor((existing.expiresAt - Date.now()) / 1000),
    };
  }

  const redis = getRedis();
  const existing = await redis.get(lockKey);

  if (!existing) {
    return null;
  }

  const lock = JSON.parse(existing);
  const ttl = await redis.ttl(lockKey);

  return {
    ...lock,
    lockKey,
    ttlSeconds: ttl,
  };
}

/**
 * Check if a connector is available for booking at a specific time
 * 
 * @param {string} chargerId
 * @param {number} connectorId
 * @param {Date} startTime
 * @param {number} durationMinutes
 * @returns {Promise<object>}
 */
export async function checkAvailability(chargerId, connectorId, startTime, durationMinutes) {
  // Check current lock
  const currentLock = await getLockStatus(chargerId, connectorId);
  
  if (currentLock && currentLock.type === LockType.CHARGING) {
    return {
      available: false,
      reason: "Connector currently in use",
      currentLock,
    };
  }

  // Check time slot bookings
  const slots = getTimeSlots(startTime, durationMinutes);
  const conflictingSlots = [];
  const useMemory = await shouldUseMemoryFallback();

  for (const slot of slots) {
    const slotKey = getBookingSlotKey(chargerId, connectorId, slot);
    
    let booking;
    if (useMemory) {
      const slotData = memorySlots.get(slotKey);
      if (slotData && slotData.expiresAt > Date.now()) {
        booking = slotData.data;
      } else if (slotData) {
        memorySlots.delete(slotKey);
      }
    } else {
      const redis = getRedis();
      const data = await redis.get(slotKey);
      if (data) {
        booking = JSON.parse(data);
      }
    }
    
    if (booking) {
      conflictingSlots.push({
        slot,
        booking,
      });
    }
  }

  if (conflictingSlots.length > 0) {
    return {
      available: false,
      reason: "Time slot already booked",
      conflicts: conflictingSlots,
    };
  }

  return { available: true };
}

/**
 * Reserve time slots for a booking
 * 
 * @param {object} params
 * @param {string} params.chargerId
 * @param {number} params.connectorId
 * @param {string} params.bookingId
 * @param {Date} params.startTime
 * @param {number} params.durationMinutes
 * @param {number} params.graceMinutes - Grace period after expiry
 * @returns {Promise<object>}
 */
export async function reserveTimeSlots({
  chargerId,
  connectorId,
  bookingId,
  startTime,
  durationMinutes,
  graceMinutes = 15,
}) {
  const slots = getTimeSlots(startTime, durationMinutes);
  const totalMinutes = durationMinutes + graceMinutes;
  
  // TTL should cover from now until end of booking + grace
  const endTime = new Date(startTime);
  endTime.setMinutes(endTime.getMinutes() + totalMinutes);
  const ttlSeconds = Math.max(60, Math.floor((endTime.getTime() - Date.now()) / 1000));

  const bookingData = {
    bookingId,
    startTime: startTime.toISOString(),
    durationMinutes,
    graceMinutes,
  };

  const useMemory = await shouldUseMemoryFallback();

  if (useMemory) {
    // Check all slots first
    for (const slot of slots) {
      const slotKey = getBookingSlotKey(chargerId, connectorId, slot);
      const existing = memorySlots.get(slotKey);
      if (existing && existing.expiresAt > Date.now()) {
        return {
          reserved: false,
          reason: "Some time slots already booked",
        };
      }
    }
    
    // Reserve all slots
    for (const slot of slots) {
      const slotKey = getBookingSlotKey(chargerId, connectorId, slot);
      memorySlots.set(slotKey, {
        data: bookingData,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    }

    return {
      reserved: true,
      slots,
      expiresAt: endTime.toISOString(),
    };
  }

  // Use Redis transaction
  const redis = getRedis();
  const multi = redis.multi();
  const bookingDataStr = JSON.stringify(bookingData);

  for (const slot of slots) {
    const slotKey = getBookingSlotKey(chargerId, connectorId, slot);
    multi.set(slotKey, bookingDataStr, "EX", ttlSeconds, "NX");
  }

  const results = await multi.exec();

  // Check if all slots were reserved
  const failed = results.some(([err, result]) => err || result !== "OK");

  if (failed) {
    // Rollback - delete any slots we did reserve
    for (const slot of slots) {
      const slotKey = getBookingSlotKey(chargerId, connectorId, slot);
      await redis.del(slotKey);
    }

    return {
      reserved: false,
      reason: "Some time slots already booked",
    };
  }

  return {
    reserved: true,
    slots,
    expiresAt: endTime.toISOString(),
  };
}

/**
 * Release time slots for a cancelled booking
 * 
 * @param {string} chargerId
 * @param {number} connectorId
 * @param {string} bookingId
 * @param {Date} startTime
 * @param {number} durationMinutes
 * @returns {Promise<object>}
 */
export async function releaseTimeSlots(chargerId, connectorId, bookingId, startTime, durationMinutes) {
  const slots = getTimeSlots(startTime, durationMinutes);
  let releasedCount = 0;
  const useMemory = await shouldUseMemoryFallback();

  for (const slot of slots) {
    const slotKey = getBookingSlotKey(chargerId, connectorId, slot);

    if (useMemory) {
      const existing = memorySlots.get(slotKey);
      if (existing && existing.data.bookingId === bookingId) {
        memorySlots.delete(slotKey);
        releasedCount++;
      }
    } else {
      const redis = getRedis();
      const existing = await redis.get(slotKey);
      if (existing) {
        const booking = JSON.parse(existing);
        if (booking.bookingId === bookingId) {
          await redis.del(slotKey);
          releasedCount++;
        }
      }
    }
  }

  return {
    released: true,
    slotsReleased: releasedCount,
  };
}

/**
 * Mark connector as in use (charging)
 * 
 * @param {string} chargerId
 * @param {number} connectorId
 * @param {string} transactionId
 * @returns {Promise<object>}
 */
export async function markChargingActive(chargerId, connectorId, transactionId) {
  // Charging sessions don't have a fixed duration, use long TTL
  // The lock will be released when session ends
  const ttlSeconds = 24 * 60 * 60; // 24 hours max

  return acquireLock({
    chargerId,
    connectorId,
    lockType: LockType.CHARGING,
    holderId: transactionId,
    ttlSeconds,
  });
}

/**
 * Mark connector as available (charging ended)
 * 
 * @param {string} chargerId
 * @param {number} connectorId
 * @param {string} transactionId
 * @returns {Promise<object>}
 */
export async function markChargingComplete(chargerId, connectorId, transactionId) {
  return releaseLock(chargerId, connectorId, transactionId);
}

/**
 * Get time slots for a duration
 * @param {Date} startTime
 * @param {number} durationMinutes
 * @returns {string[]} Array of ISO date strings (hour precision)
 */
function getTimeSlots(startTime, durationMinutes) {
  const slots = [];
  const start = new Date(startTime);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + durationMinutes);

  // Round start to current hour
  const current = new Date(start);
  current.setMinutes(0, 0, 0);

  while (current < end) {
    slots.push(current.toISOString());
    current.setHours(current.getHours() + 1);
  }

  return slots;
}

export default {
  LockType,
  acquireLock,
  releaseLock,
  forceReleaseLock,
  getLockStatus,
  checkAvailability,
  reserveTimeSlots,
  releaseTimeSlots,
  markChargingActive,
  markChargingComplete,
};
