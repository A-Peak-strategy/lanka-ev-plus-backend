import { sendCallResult } from "../messageQueue.js";
import { RegistrationStatus } from "../ocppConstants.js";
import { updateChargerState } from "../../services/chargerStore.service.js";
import { syncChargerToDb } from "../../services/chargerPersistence.service.js";
import { ocppEvents } from "../ocppEvents.js";
import prisma from "../../config/db.js";

/**
 * OCPP BootNotification Handler
 * 
 * Sent by the Charge Point when it boots up or reconnects.
 * Contains hardware information about the charger.
 * 
 * Request: {
 *   chargePointVendor: string,
 *   chargePointModel: string,
 *   chargePointSerialNumber?: string,
 *   chargeBoxSerialNumber?: string,
 *   firmwareVersion?: string,
 *   iccid?: string,
 *   imsi?: string,
 *   meterType?: string,
 *   meterSerialNumber?: string
 * }
 * 
 * Response: {
 *   status: "Accepted" | "Pending" | "Rejected",
 *   currentTime: ISO8601,
 *   interval: number (heartbeat interval in seconds)
 * }
 */

// Default heartbeat interval (seconds)
const HEARTBEAT_INTERVAL = 300; // 5 minutes

export default async function bootNotification(ws, messageId, chargerId, payload) {
  const {
    chargePointVendor,
    chargePointModel,
    chargePointSerialNumber,
    chargeBoxSerialNumber,
    firmwareVersion,
    iccid,
    imsi,
    meterType,
    meterSerialNumber,
  } = payload;

  console.log(`[BOOT] ${chargerId}: ${chargePointVendor} ${chargePointModel}`);

  // Check if charger is registered/allowed
  const registrationResult = await checkChargerRegistration(
    chargerId,
    chargePointSerialNumber || chargeBoxSerialNumber
  );

  // Update charger state
  updateChargerState(chargerId, {
    vendor: chargePointVendor,
    model: chargePointModel,
    serialNumber: chargePointSerialNumber || chargeBoxSerialNumber,
    firmwareVersion,
    iccid,
    imsi,
    meterType,
    meterSerialNumber,
    status: "Available",
    connectionStatus: "Connected",
    lastHeartbeat: new Date(),
    lastBoot: new Date(),
  });

  // Sync to database
  await syncChargerToDb(chargerId);

  // Update or create charger in database with full info
  await upsertCharger(chargerId, {
    chargePointVendor,
    chargePointModel,
    chargePointSerialNumber: chargePointSerialNumber || chargeBoxSerialNumber,
    firmwareVersion,
    registrationResult,
  });

  // Emit event
  ocppEvents.emitChargerBooted(chargerId, payload);

  // Send response
  sendCallResult(ws, messageId, {
    status: registrationResult.status,
    currentTime: new Date().toISOString(),
    interval: HEARTBEAT_INTERVAL,
  });
}

/**
 * Check if charger is registered and allowed to connect
 * 
 * @param {string} chargerId
 * @param {string} serialNumber
 * @returns {Promise<object>}
 */
async function checkChargerRegistration(chargerId, serialNumber) {
  try {
    // Check if charger exists in database
    const charger = await prisma.charger.findUnique({
      where: { id: chargerId },
    });

    if (charger) {
      // Existing charger
      if (charger.isRegistered) {
        return { status: RegistrationStatus.ACCEPTED, isNew: false };
      } else {
        // Charger exists but not yet registered by admin
        // Accept but could return Pending if registration is required
        return { status: RegistrationStatus.ACCEPTED, isNew: false };
      }
    }

    // New charger - auto-register (or return Pending if manual registration required)
    // For now, accept all chargers (configure in production)
    return { status: RegistrationStatus.ACCEPTED, isNew: true };
  } catch (error) {
    console.error("Error checking charger registration:", error);
    return { status: RegistrationStatus.ACCEPTED, isNew: true };
  }
}

/**
 * Create or update charger in database
 * 
 * @param {string} chargerId
 * @param {object} data
 */
async function upsertCharger(chargerId, data) {
  try {
    await prisma.charger.upsert({
      where: { id: chargerId },
      create: {
        id: chargerId,
        serialNumber: data.chargePointSerialNumber,
        vendor: data.chargePointVendor,
        model: data.chargePointModel,
        firmwareVersion: data.firmwareVersion,
        status: "AVAILABLE",
        connectionState: "CONNECTED",
        lastHeartbeat: new Date(),
        lastSeen: new Date(),
        isRegistered: data.registrationResult.isNew ? false : true,
        registeredAt: data.registrationResult.isNew ? null : new Date(),
      },
      update: {
        vendor: data.chargePointVendor,
        model: data.chargePointModel,
        firmwareVersion: data.firmwareVersion,
        status: "AVAILABLE",
        connectionState: "CONNECTED",
        lastHeartbeat: new Date(),
        lastSeen: new Date(),
      },
    });
  } catch (error) {
    console.error("Error upserting charger:", error);
  }
}
