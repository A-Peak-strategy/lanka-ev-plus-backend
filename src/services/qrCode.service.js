import QRCode from "qrcode";
import cloudinary from "../config/cloudinary.js";
import prisma from "../config/db.js";
import crypto from "crypto";

/**
 * Generate a unique 6-digit backup code
 * @returns {string}
 */
function generateBackupCode() {
    return crypto.randomInt(100000, 999999).toString();
}

/**
 * Generate QR code data string for a charger
 * @param {string} chargerId
 * @returns {string}
 */
function generateQRDataString(chargerId) {
    return `evcharge://charger/${chargerId}`;
}

/**
 * Upload a buffer to Cloudinary
 * @param {Buffer} buffer
 * @param {string} publicId
 * @returns {Promise<object>}
 */
async function uploadToCloudinary(buffer, publicId) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: "charger-qr-codes",
                public_id: publicId,
                format: "png",
                overwrite: true,
                resource_type: "image",
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        uploadStream.end(buffer);
    });
}

/**
 * Delete an image from Cloudinary
 * @param {string} publicId
 */
async function deleteFromCloudinary(publicId) {
    try {
        await cloudinary.uploader.destroy(`charger-qr-codes/${publicId}`);
    } catch (error) {
        console.warn("Failed to delete old Cloudinary image:", error.message);
    }
}

/**
 * Generate QR code + 6-digit backup code for a charger
 * 
 * @param {string} chargerId
 * @returns {Promise<object>}
 */
export async function generateChargerQR(chargerId) {
    // Verify charger exists
    const charger = await prisma.charger.findUnique({ where: { id: chargerId } });
    if (!charger) throw new Error("Charger not found");

    if (charger.qrCode) {
        throw new Error("QR code already exists. Use regenerate to create a new one.");
    }

    const qrDataString = generateQRDataString(chargerId);
    const backupCode = generateBackupCode();

    // Generate QR code as PNG buffer
    const qrBuffer = await QRCode.toBuffer(qrDataString, {
        type: "png",
        width: 512,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
        errorCorrectionLevel: "H",
    });

    // Upload to Cloudinary
    const cloudinaryResult = await uploadToCloudinary(qrBuffer, `qr-${chargerId}`);

    // Save to database
    const updated = await prisma.charger.update({
        where: { id: chargerId },
        data: {
            qrCode: qrDataString,
            qrCodeImageUrl: cloudinaryResult.secure_url,
            backupCode: backupCode,
            codesGeneratedAt: new Date(),
        },
    });

    return {
        chargerId,
        qrCode: qrDataString,
        qrCodeImageUrl: cloudinaryResult.secure_url,
        backupCode: backupCode,
        generatedAt: updated.codesGeneratedAt,
    };
}

/**
 * Regenerate QR code + backup code for a charger (replaces old ones)
 * 
 * @param {string} chargerId
 * @returns {Promise<object>}
 */
export async function regenerateChargerQR(chargerId) {
    const charger = await prisma.charger.findUnique({ where: { id: chargerId } });
    if (!charger) throw new Error("Charger not found");

    // Delete old Cloudinary image if exists
    if (charger.qrCodeImageUrl) {
        await deleteFromCloudinary(`qr-${chargerId}`);
    }

    const qrDataString = generateQRDataString(chargerId);
    const backupCode = generateBackupCode();

    // Generate new QR code
    const qrBuffer = await QRCode.toBuffer(qrDataString, {
        type: "png",
        width: 512,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
        errorCorrectionLevel: "H",
    });

    // Upload to Cloudinary
    const cloudinaryResult = await uploadToCloudinary(qrBuffer, `qr-${chargerId}`);

    // Update database
    const updated = await prisma.charger.update({
        where: { id: chargerId },
        data: {
            qrCode: qrDataString,
            qrCodeImageUrl: cloudinaryResult.secure_url,
            backupCode: backupCode,
            codesGeneratedAt: new Date(),
        },
    });

    return {
        chargerId,
        qrCode: qrDataString,
        qrCodeImageUrl: cloudinaryResult.secure_url,
        backupCode: backupCode,
        generatedAt: updated.codesGeneratedAt,
    };
}

/**
 * Get QR code info for a charger
 * 
 * @param {string} chargerId
 * @returns {Promise<object|null>}
 */
export async function getChargerQR(chargerId) {
    const charger = await prisma.charger.findUnique({
        where: { id: chargerId },
        select: {
            id: true,
            qrCode: true,
            qrCodeImageUrl: true,
            backupCode: true,
            codesGeneratedAt: true,
        },
    });

    if (!charger) throw new Error("Charger not found");
    if (!charger.qrCode) return null;

    return {
        chargerId: charger.id,
        qrCode: charger.qrCode,
        qrCodeImageUrl: charger.qrCodeImageUrl,
        backupCode: charger.backupCode,
        generatedAt: charger.codesGeneratedAt,
    };
}

export default {
    generateChargerQR,
    regenerateChargerQR,
    getChargerQR,
};
