/*
  Warnings:

  - You are about to drop the `chargingsession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `graceperiodjob` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `settlementitem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[qrCode]` on the table `Charger` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[encryptedCode]` on the table `Charger` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[backupCode]` on the table `Charger` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE `chargingsession` DROP FOREIGN KEY `ChargingSession_chargerId_fkey`;

-- DropForeignKey
ALTER TABLE `chargingsession` DROP FOREIGN KEY `ChargingSession_connectorId_fkey`;

-- DropForeignKey
ALTER TABLE `settlementitem` DROP FOREIGN KEY `SettlementItem_settlementId_fkey`;

-- AlterTable
ALTER TABLE `Charger` ADD COLUMN `backupCode` VARCHAR(191) NULL,
    ADD COLUMN `codesGeneratedAt` DATETIME(3) NULL,
    ADD COLUMN `encryptedCode` VARCHAR(191) NULL,
    ADD COLUMN `qrCode` VARCHAR(191) NULL,
    ADD COLUMN `qrCodeImageUrl` VARCHAR(191) NULL;

-- DropForeignKey (must drop FKs referencing chargingsession BEFORE dropping the table)
ALTER TABLE `ChargingSessionLive` DROP FOREIGN KEY `ChargingSessionLive_sessionId_fkey`;
ALTER TABLE `chargingsession` DROP FOREIGN KEY `chargingsession_userId_fkey`;

-- DropForeignKey (must drop FKs referencing user BEFORE dropping the table)
ALTER TABLE `Wallet` DROP FOREIGN KEY `Wallet_userId_fkey`;
ALTER TABLE `Ledger` DROP FOREIGN KEY `Ledger_userId_fkey`;
ALTER TABLE `Station` DROP FOREIGN KEY `Station_ownerId_fkey`;
ALTER TABLE `Booking` DROP FOREIGN KEY `Booking_userId_fkey`;
ALTER TABLE `Payment` DROP FOREIGN KEY `Payment_userId_fkey`;

-- DropTable
DROP TABLE `chargingsession`;

-- DropTable
DROP TABLE `graceperiodjob`;

-- DropTable
DROP TABLE `settlementitem`;

-- DropTable
DROP TABLE `user`;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `firebaseUid` VARCHAR(191) NOT NULL,
    `ocppIdTag` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `role` ENUM('CONSUMER', 'OWNER', 'ADMIN') NOT NULL DEFAULT 'CONSUMER',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_firebaseUid_key`(`firebaseUid`),
    UNIQUE INDEX `User_ocppIdTag_key`(`ocppIdTag`),
    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_phone_key`(`phone`),
    INDEX `User_firebaseUid_idx`(`firebaseUid`),
    INDEX `User_email_idx`(`email`),
    INDEX `User_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChargingSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `transactionId` INTEGER NOT NULL,
    `chargerId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `idTag` VARCHAR(191) NULL,
    `meterStartWh` INTEGER NULL,
    `meterStopWh` INTEGER NULL,
    `energyUsedWh` INTEGER NOT NULL DEFAULT 0,
    `pricePerKwh` DECIMAL(10, 2) NULL,
    `totalCost` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `ownerEarning` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `commission` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `lastBilledWh` INTEGER NOT NULL DEFAULT 0,
    `graceStartedAt` DATETIME(3) NULL,
    `gracePeriodSec` INTEGER NULL,
    `stopReason` ENUM('USER_REQUESTED', 'REMOTE_STOP', 'GRACE_EXPIRED', 'ZERO_BALANCE', 'CHARGER_FAULT', 'EMERGENCY_STOP', 'OTHER') NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ChargingSession_transactionId_key`(`transactionId`),
    INDEX `ChargingSession_chargerId_idx`(`chargerId`),
    INDEX `ChargingSession_userId_idx`(`userId`),
    INDEX `ChargingSession_transactionId_idx`(`transactionId`),
    INDEX `ChargingSession_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GracePeriodJob` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `transactionId` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `bullJobId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `status` ENUM('ACTIVE', 'CANCELLED', 'EXECUTED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GracePeriodJob_sessionId_key`(`sessionId`),
    UNIQUE INDEX `GracePeriodJob_transactionId_key`(`transactionId`),
    INDEX `GracePeriodJob_transactionId_idx`(`transactionId`),
    INDEX `GracePeriodJob_expiresAt_idx`(`expiresAt`),
    INDEX `GracePeriodJob_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SettlementItem` (
    `id` VARCHAR(191) NOT NULL,
    `settlementId` VARCHAR(191) NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `transactionId` INTEGER NOT NULL,
    `energyWh` INTEGER NOT NULL,
    `grossAmount` DECIMAL(12, 2) NOT NULL,
    `commission` DECIMAL(12, 2) NOT NULL,
    `netAmount` DECIMAL(12, 2) NOT NULL,
    `sessionDate` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SettlementItem_settlementId_idx`(`settlementId`),
    INDEX `SettlementItem_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Charger_qrCode_key` ON `Charger`(`qrCode`);

-- CreateIndex
CREATE UNIQUE INDEX `Charger_encryptedCode_key` ON `Charger`(`encryptedCode`);

-- CreateIndex
CREATE UNIQUE INDEX `Charger_backupCode_key` ON `Charger`(`backupCode`);

-- AddForeignKey
ALTER TABLE `Wallet` ADD CONSTRAINT `Wallet_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ledger` ADD CONSTRAINT `Ledger_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Station` ADD CONSTRAINT `Station_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargingSession` ADD CONSTRAINT `ChargingSession_chargerId_fkey` FOREIGN KEY (`chargerId`) REFERENCES `Charger`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargingSession` ADD CONSTRAINT `ChargingSession_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `Connector`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargingSession` ADD CONSTRAINT `ChargingSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SettlementItem` ADD CONSTRAINT `SettlementItem_settlementId_fkey` FOREIGN KEY (`settlementId`) REFERENCES `Settlement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargingSessionLive` ADD CONSTRAINT `ChargingSessionLive_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ChargingSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
