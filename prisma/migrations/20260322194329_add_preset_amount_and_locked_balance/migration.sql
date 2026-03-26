-- AlterTable
ALTER TABLE `ChargingSession` ADD COLUMN `presetAmount` DECIMAL(12, 2) NULL;

-- AlterTable
ALTER TABLE `Wallet` ADD COLUMN `lockedBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0;
