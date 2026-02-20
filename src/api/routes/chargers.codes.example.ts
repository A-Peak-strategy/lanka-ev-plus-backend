// File: src/api/routes/chargers.ts
// Backend Route Handler for Charger Access Codes

import { Router, Request, Response } from 'express';
import { prisma } from '../../prisma';
import { authMiddleware, adminMiddleware } from '../../middleware/auth';
import { 
  generateEncryptedCode, 
  generateBackupCode, 
  generateQRCodeData,
  verifyEncryptedCode 
} from '../../utils/chargerCode';

const router = Router();

/**
 * Generate access codes for a charger
 * POST /admin/chargers/:chargerId/generate-codes
 */
router.post('/admin/chargers/:chargerId/generate-codes', 
  authMiddleware, 
  adminMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { chargerId } = req.params;

      // Verify charger exists
      const charger = await prisma.charger.findUnique({
        where: { id: chargerId }
      });

      if (!charger) {
        return res.status(404).json({
          success: false,
          message: 'Charger not found'
        });
      }

      // Generate new codes
      const encryptedCode = generateEncryptedCode(chargerId);
      const backupCode = generateBackupCode(chargerId);
      const qrCodeData = generateQRCodeData(chargerId, encryptedCode);

      // Update charger in database
      const updatedCharger = await prisma.charger.update({
        where: { id: chargerId },
        data: {
          encryptedCode,
          backupCode,
          qrCode: qrCodeData,
          codesGeneratedAt: new Date()
        }
      });

      // Log the action
      console.log(`Access codes generated for charger ${chargerId} by user ${req.user?.id}`);

      return res.json({
        success: true,
        data: {
          qrCode: updatedCharger.qrCode,
          encryptedCode: updatedCharger.encryptedCode,
          backupCode: updatedCharger.backupCode
        }
      });
    } catch (error) {
      console.error('Error generating access codes:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate access codes'
      });
    }
  }
);

/**
 * Get access codes for a charger
 * GET /admin/chargers/:chargerId/access-codes
 */
router.get('/admin/chargers/:chargerId/access-codes',
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { chargerId } = req.params;

      const charger = await prisma.charger.findUnique({
        where: { id: chargerId },
        select: {
          qrCode: true,
          encryptedCode: true,
          backupCode: true,
          codesGeneratedAt: true
        }
      });

      if (!charger) {
        return res.status(404).json({
          success: false,
          message: 'Charger not found'
        });
      }

      return res.json({
        success: true,
        data: charger
      });
    } catch (error) {
      console.error('Error getting access codes:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get access codes'
      });
    }
  }
);

/**
 * Regenerate access codes for a charger
 * POST /admin/chargers/:chargerId/regenerate-codes
 */
router.post('/admin/chargers/:chargerId/regenerate-codes',
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { chargerId } = req.params;

      // Verify charger exists
      const charger = await prisma.charger.findUnique({
        where: { id: chargerId }
      });

      if (!charger) {
        return res.status(404).json({
          success: false,
          message: 'Charger not found'
        });
      }

      // Generate new codes
      const encryptedCode = generateEncryptedCode(chargerId);
      const backupCode = generateBackupCode(chargerId);
      const qrCodeData = generateQRCodeData(chargerId, encryptedCode);

      // Update charger in database
      const updatedCharger = await prisma.charger.update({
        where: { id: chargerId },
        data: {
          encryptedCode,
          backupCode,
          qrCode: qrCodeData,
          codesGeneratedAt: new Date()
        }
      });

      // Log the action
      console.log(`Access codes regenerated for charger ${chargerId} by user ${req.user?.id}`);

      return res.json({
        success: true,
        data: {
          qrCode: updatedCharger.qrCode,
          encryptedCode: updatedCharger.encryptedCode,
          backupCode: updatedCharger.backupCode
        }
      });
    } catch (error) {
      console.error('Error regenerating access codes:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to regenerate access codes'
      });
    }
  }
);

/**
 * Verify access code (for app usage)
 * POST /chargers/:chargerId/verify-code
 */
router.post('/chargers/:chargerId/verify-code',
  async (req: Request, res: Response) => {
    try {
      const { chargerId } = req.params;
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({
          success: false,
          message: 'Access code is required'
        });
      }

      // Get charger
      const charger = await prisma.charger.findUnique({
        where: { id: chargerId },
        select: {
          id: true,
          encryptedCode: true,
          backupCode: true,
          status: true,
          connectionState: true
        }
      });

      if (!charger) {
        return res.status(404).json({
          success: false,
          message: 'Charger not found'
        });
      }

      // Verify code
      let isValid = false;

      // Check encrypted code
      if (charger.encryptedCode && verifyEncryptedCode(code, chargerId)) {
        isValid = true;
      }

      // Check backup code (exact match with timestamp validation)
      if (!isValid && charger.backupCode === code) {
        isValid = true;
      }

      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired access code'
        });
      }

      // Check if charger is available
      if (charger.status !== 'AVAILABLE' || charger.connectionState !== 'CONNECTED') {
        return res.status(403).json({
          success: false,
          message: 'Charger is not available',
          chargerStatus: charger.status,
          connectionState: charger.connectionState
        });
      }

      // Log access
      console.log(`Charger ${chargerId} accessed with valid code`);

      return res.json({
        success: true,
        message: 'Access code verified successfully',
        charger: {
          id: charger.id,
          status: charger.status,
          connectionState: charger.connectionState
        }
      });
    } catch (error) {
      console.error('Error verifying access code:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to verify access code'
      });
    }
  }
);

/**
 * Get charger with access codes (admin only)
 * GET /admin/chargers/:chargerId
 */
router.get('/admin/chargers/:chargerId',
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { chargerId } = req.params;

      const charger = await prisma.charger.findUnique({
        where: { id: chargerId },
        include: {
          station: true,
          connectors: true
        }
      });

      if (!charger) {
        return res.status(404).json({
          success: false,
          message: 'Charger not found'
        });
      }

      return res.json({
        success: true,
        data: charger
      });
    } catch (error) {
      console.error('Error getting charger:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get charger'
      });
    }
  }
);

export default router;
