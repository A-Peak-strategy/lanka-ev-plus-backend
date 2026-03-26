import prisma from "../config/db.js";
import Decimal from "decimal.js";

/**
 * Admin Service
 * 
 * Handles all administrative operations:
 * - User management (create owners)
 * - Charger registration
 * - Station management
 * - Pricing configuration
 * - Session monitoring
 * - Audit logging
 */

// ============================================
// USER MANAGEMENT
// ============================================

/**
 * Create a station owner account
 * 
 * @param {object} data
 * @param {string} adminId - Admin performing the action
 * @returns {Promise<object>}
 */
export async function createOwner(data, adminId) {
  const {
    email,
    phone,
    name,
    firebaseUid,
  } = data;

  // Validate required fields
  if (!email && !phone) {
    throw new Error("Email or phone is required");
  }

  if (!firebaseUid) {
    throw new Error("Firebase UID is required");
  }

  // Create owner user
  const owner = await prisma.user.create({
    data: {
      firebaseUid,
      email,
      phone,
      name,
      role: "OWNER",
      isActive: true,
      ocppIdTag: makeOcppIdTag(),
    },
  });

  // Create wallet for owner (for earnings tracking)
  await prisma.wallet.create({
    data: {
      userId: owner.id,
      balance: 0,
      currency: "LKR",
    },
  });

  // Audit log
  await logAdminAction({
    adminId,
    action: "CREATE_OWNER",
    targetType: "USER",
    targetId: owner.id,
    newValue: { email, phone, name, role: "OWNER" },
  });

  return owner;
}

function makeOcppIdTag() {
  // 12 chars, safe
  return "O" + crypto.randomBytes(6).toString("hex").toUpperCase(); 
}

/**
 * Get all users with optional filters
 * 
 * @param {object} filters
 * @returns {Promise<object[]>}
 */
export async function getUsers(filters = {}) {
  const { role, isActive, limit = 50, offset = 0 } = filters;

  const where = {};
  if (role) where.role = role;
  if (isActive !== undefined) where.isActive = isActive;

  return prisma.user.findMany({
    where,
    include: {
      wallet: {
        select: { balance: true },
      },
      ownedStations: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
}

/**
 * Update user status (activate/deactivate)
 * 
 * @param {string} userId
 * @param {boolean} isActive
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function updateUserStatus(userId, isActive, adminId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new Error("User not found");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isActive },
  });

  await logAdminAction({
    adminId,
    action: isActive ? "ACTIVATE_USER" : "DEACTIVATE_USER",
    targetType: "USER",
    targetId: userId,
    previousValue: { isActive: user.isActive },
    newValue: { isActive },
  });

  return updated;
}

// ============================================
// CHARGER MANAGEMENT
// ============================================

/**
 * Register a new charger (by serial number)
 * 
 * @param {object} data
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function registerCharger(data, adminId) {
  const {
    id,
    serialNumber,
    stationId,
    numberOfConnectors = 1,
  } = data;

  if (!serialNumber) {
    throw new Error("Serial number is required");
  }

  // Check for duplicate serial
  const existing = await prisma.charger.findFirst({
    where: { serialNumber },
  });

  if (existing) {
    throw new Error("Charger with this serial number already exists");
  }

  // Validate station if provided
  if (stationId) {
    const station = await prisma.station.findUnique({ where: { id: stationId } });
    if (!station) {
      throw new Error("Station not found");
    }
  }

  // Create charger
  const charger = await prisma.charger.create({
    data: {
      id: id || serialNumber, // Use serial as ID if not provided
      serialNumber,
      stationId,
      isRegistered: true,
      registeredAt: new Date(),
      status: "UNAVAILABLE",
      connectionState: "DISCONNECTED",
    },
  });

  // Create connectors
  for (let i = 1; i <= numberOfConnectors; i++) {
    await prisma.connector.create({
      data: {
        chargerId: charger.id,
        connectorId: i,
        status: "UNAVAILABLE",
      },
    });
  }

  await logAdminAction({
    adminId,
    action: "REGISTER_CHARGER",
    targetType: "CHARGER",
    targetId: charger.id,
    newValue: { serialNumber, stationId, numberOfConnectors },
  });

  return charger;
}

/**
 * Get all chargers with status
 * 
 * @param {object} filters
 * @returns {Promise<object[]>}
 */
export async function getChargers(filters = {}) {
  const { stationId, status, isRegistered, limit = 50, offset = 0 } = filters;

  const where = {};
  if (stationId) where.stationId = stationId;
  if (status) where.status = status;
  if (isRegistered !== undefined) where.isRegistered = isRegistered;

  return prisma.charger.findMany({
    where,
    include: {
      station: {
        select: { id: true, name: true, owner: { select: { id: true, name: true } } },
      },
      connectors: true,
      _count: {
        select: { sessions: true },
      },
    },
    orderBy: { lastSeen: "desc" },
    take: limit,
    skip: offset,
  });
}

/**
 * Get a single charger by ID with full details
 * 
 * @param {string} chargerId
 * @returns {Promise<object>}
 */
export async function getChargerById(chargerId) {
  const charger = await prisma.charger.findUnique({
    where: { id: chargerId },
    include: {
      station: {
        select: { id: true, name: true, owner: { select: { id: true, name: true } } },
      },
      connectors: {
        orderBy: { connectorId: "asc" },
      },
      _count: {
        select: { sessions: true },
      },
    },
  });

  if (!charger) throw new Error("Charger not found");
  return charger;
}

/**
 * Assign charger to station
 * 
 * @param {string} chargerId
 * @param {string} stationId
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function assignChargerToStation(chargerId, stationId, adminId) {
  const charger = await prisma.charger.findUnique({ where: { id: chargerId } });
  if (!charger) throw new Error("Charger not found");

  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) throw new Error("Station not found");

  const updated = await prisma.charger.update({
    where: { id: chargerId },
    data: { stationId },
  });

  await logAdminAction({
    adminId,
    action: "ASSIGN_CHARGER_TO_STATION",
    targetType: "CHARGER",
    targetId: chargerId,
    previousValue: { stationId: charger.stationId },
    newValue: { stationId },
  });

  return updated;
}

// ============================================
// STATION MANAGEMENT
// ============================================

/**
 * Create a new station
 * 
 * @param {object} data
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function createStation(data, adminId) {
  const {
    name,
    address,
    latitude,
    longitude,
    ownerId,
    pricingId,
    bookingEnabled = true,
  } = data;

  // Validate owner
  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!owner) throw new Error("Owner not found");
  if (owner.role !== "OWNER") throw new Error("User is not a station owner");

  // Validate pricing if provided
  if (pricingId) {
    const pricing = await prisma.pricing.findUnique({ where: { id: pricingId } });
    if (!pricing) throw new Error("Pricing not found");
  }

  const station = await prisma.station.create({
    data: {
      name,
      address,
      latitude,
      longitude,
      ownerId,
      pricingId,
      bookingEnabled,
    },
  });

  await logAdminAction({
    adminId,
    action: "CREATE_STATION",
    targetType: "STATION",
    targetId: station.id,
    newValue: { name, address, ownerId },
  });

  return station;
}

/**
 * Get all stations
 * 
 * @param {object} filters
 * @returns {Promise<object[]>}
 */
export async function getStations(filters = {}) {
  const { ownerId, isActive, limit = 50, offset = 0 } = filters;

  const where = {};
  if (ownerId) where.ownerId = ownerId;
  if (isActive !== undefined) where.isActive = isActive;

  return prisma.station.findMany({
    where,
    include: {
      owner: {
        select: { id: true, name: true, email: true },
      },
      pricing: true,
      chargers: {
        select: { id: true, serialNumber: true, status: true, connectionState: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
}

/**
 * Assign station to owner
 * 
 * @param {string} stationId
 * @param {string} ownerId
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function assignStationToOwner(stationId, ownerId, adminId) {
  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) throw new Error("Station not found");

  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!owner || owner.role !== "OWNER") throw new Error("Invalid owner");

  const updated = await prisma.station.update({
    where: { id: stationId },
    data: { ownerId },
  });

  await logAdminAction({
    adminId,
    action: "ASSIGN_STATION_TO_OWNER",
    targetType: "STATION",
    targetId: stationId,
    previousValue: { ownerId: station.ownerId },
    newValue: { ownerId },
  });

  return updated;
}

// ============================================
// PRICING CONFIGURATION
// ============================================

/**
 * Create pricing configuration
 * 
 * @param {object} data
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function createPricing(data, adminId) {
  const {
    name,
    pricePerKwh,
    commissionRate = 2.00, // Default 2% per SRS
    gracePeriodSec = 60,
    lowBalanceThreshold = 300.00,
    graceStartThreshold = 100.00,
    isDefault = false,
  } = data;

  // If setting as default, unset current default
  if (isDefault) {
    await prisma.pricing.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }

  const pricing = await prisma.pricing.create({
    data: {
      name,
      pricePerKwh,
      commissionRate,
      gracePeriodSec,
      lowBalanceThreshold,
      graceStartThreshold,
      isDefault,
      isActive: true,
    },
  });

  await logAdminAction({
    adminId,
    action: "CREATE_PRICING",
    targetType: "PRICING",
    targetId: pricing.id,
    newValue: { name, pricePerKwh, commissionRate },
  });

  return pricing;
}

/**
 * Update pricing configuration
 * 
 * @param {string} pricingId
 * @param {object} data
 * @param {string} adminId
 * @returns {Promise<object>}
 */
export async function updatePricing(pricingId, data, adminId) {
  const current = await prisma.pricing.findUnique({ where: { id: pricingId } });
  if (!current) throw new Error("Pricing not found");

  // Whitelist allowed fields to prevent overwriting id, createdAt, etc.
  const allowedFields = ["name", "pricePerKwh", "commissionRate", "gracePeriodSec", "lowBalanceThreshold", "graceStartThreshold", "isDefault", "isActive"];
  const sanitizedData = {};
  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      sanitizedData[key] = data[key];
    }
  }

  const updated = await prisma.pricing.update({
    where: { id: pricingId },
    data: sanitizedData,
  });

  await logAdminAction({
    adminId,
    action: "UPDATE_PRICING",
    targetType: "PRICING",
    targetId: pricingId,
    previousValue: current,
    newValue: data,
  });

  return updated;
}

/**
 * Get all pricing configurations
 */
export async function getPricings() {
  return prisma.pricing.findMany({
    include: {
      _count: {
        select: { stations: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Assign pricing to station
 */
export async function assignPricingToStation(stationId, pricingId, adminId) {
  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) throw new Error("Station not found");

  const pricing = await prisma.pricing.findUnique({ where: { id: pricingId } });
  if (!pricing) throw new Error("Pricing not found");

  const updated = await prisma.station.update({
    where: { id: stationId },
    data: { pricingId },
  });

  await logAdminAction({
    adminId,
    action: "ASSIGN_PRICING_TO_STATION",
    targetType: "STATION",
    targetId: stationId,
    previousValue: { pricingId: station.pricingId },
    newValue: { pricingId },
  });

  return updated;
}

// ============================================
// SESSION MONITORING
// ============================================

/**
 * Get charging sessions with filters
 * 
 * @param {object} filters
 * @returns {Promise<object[]>}
 */
export async function getSessions(filters = {}) {
  const {
    chargerId,
    userId,
    stationId,
    ownerId,
    startDate,
    endDate,
    active,
    limit = 50,
    offset = 0,
  } = filters;

  const where = {};

  if (chargerId) where.chargerId = chargerId;
  if (userId) where.userId = userId;
  if (active === true) where.endedAt = null;
  if (active === false) where.endedAt = { not: null };

  if (startDate || endDate) {
    where.startedAt = {};
    if (startDate) where.startedAt.gte = new Date(startDate);
    if (endDate) where.startedAt.lte = new Date(endDate);
  }

  // Filter by station or owner
  if (stationId || ownerId) {
    where.charger = {};
    if (stationId) where.charger.stationId = stationId;
    if (ownerId) where.charger.station = { ownerId };
  }

  return prisma.chargingSession.findMany({
    where,
    include: {
      charger: {
        include: {
          station: {
            select: { id: true, name: true, ownerId: true },
          },
        },
      },
      user: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { startedAt: "desc" },
    take: limit,
    skip: offset,
  });
}

/**
 * Get session statistics
 */
export async function getSessionStats(filters = {}) {
  const { startDate, endDate, ownerId, stationId } = filters;

  const where = {};
  if (startDate || endDate) {
    where.startedAt = {};
    if (startDate) where.startedAt.gte = new Date(startDate);
    if (endDate) where.startedAt.lte = new Date(endDate);
  }

  if (stationId || ownerId) {
    where.charger = {};
    if (stationId) where.charger.stationId = stationId;
    if (ownerId) where.charger.station = { ownerId };
  }

  const sessions = await prisma.chargingSession.findMany({
    where,
    select: {
      energyUsedWh: true,
      totalCost: true,
      ownerEarning: true,
      commission: true,
    },
  });

  const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyUsedWh || 0), 0);
  const totalRevenue = sessions.reduce(
    (sum, s) => sum.plus(new Decimal(s.totalCost?.toString() || "0")),
    new Decimal(0)
  );
  const totalOwnerEarnings = sessions.reduce(
    (sum, s) => sum.plus(new Decimal(s.ownerEarning?.toString() || "0")),
    new Decimal(0)
  );
  const totalCommission = sessions.reduce(
    (sum, s) => sum.plus(new Decimal(s.commission?.toString() || "0")),
    new Decimal(0)
  );

  return {
    sessionCount: sessions.length,
    totalEnergyKwh: (totalEnergy / 1000).toFixed(2),
    totalRevenue: totalRevenue.toFixed(2),
    totalOwnerEarnings: totalOwnerEarnings.toFixed(2),
    totalCommission: totalCommission.toFixed(2),
  };
}

// ============================================
// OCPP LOGS
// ============================================

/**
 * Get OCPP message logs
 * 
 * @param {object} filters
 * @returns {Promise<object[]>}
 */
export async function getOcppLogs(filters = {}) {
  const {
    chargerId,
    action,
    direction,
    startDate,
    endDate,
    limit = 100,
    offset = 0,
  } = filters;

  const where = {};
  if (chargerId) where.chargerId = chargerId;
  if (action) where.action = action;
  if (direction) where.direction = direction;

  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate) where.timestamp.lte = new Date(endDate);
  }

  return prisma.ocppMessageLog.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: limit,
    skip: offset,
  });
}

// ============================================
// AUDIT LOGGING
// ============================================

/**
 * Log admin action for audit trail
 */
async function logAdminAction({
  adminId,
  action,
  targetType,
  targetId,
  previousValue,
  newValue,
  ipAddress,
  userAgent,
}) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetType,
        targetId,
        previousValue,
        newValue,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    console.error("Failed to log admin action:", error);
    // Don't throw - audit logging should not fail the main operation
  }
}

/**
 * Get admin audit logs
 */
export async function getAuditLogs(filters = {}) {
  const {
    adminId,
    action,
    targetType,
    startDate,
    endDate,
    limit = 100,
    offset = 0,
  } = filters;

  const where = {};
  if (adminId) where.adminId = adminId;
  if (action) where.action = action;
  if (targetType) where.targetType = targetType;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  return prisma.adminAuditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
}

export default {
  // User management
  createOwner,
  getUsers,
  updateUserStatus,

  // Charger management
  registerCharger,
  getChargers,
  getChargerById,
  assignChargerToStation,

  // Station management
  createStation,
  getStations,
  assignStationToOwner,

  // Pricing
  createPricing,
  updatePricing,
  getPricings,
  assignPricingToStation,

  // Monitoring
  getSessions,
  getSessionStats,
  getOcppLogs,
  getAuditLogs,
};

