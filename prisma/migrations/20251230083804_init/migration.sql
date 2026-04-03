/*
  Warnings:

  - You are about to alter the column `status` on the `charger` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(2))`.
  - You are about to alter the column `connectionState` on the `charger` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(3))`.
  - A unique constraint covering the columns `[serialNumber]` on the table `Charger` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[transactionId]` on the table `ChargingSession` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Charger` ADD COLUMN `isRegistered` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `registeredAt` DATETIME(3) NULL,
    ADD COLUMN `serialNumber` VARCHAR(191) NULL,
    ADD COLUMN `stationId` VARCHAR(191) NULL,
    MODIFY `status` ENUM('AVAILABLE', 'PREPARING', 'CHARGING', 'SUSPENDED_EV', 'SUSPENDED_EVSE', 'FINISHING', 'RESERVED', 'UNAVAILABLE', 'FAULTED') NOT NULL DEFAULT 'UNAVAILABLE',
    MODIFY `connectionState` ENUM('CONNECTED', 'DISCONNECTED') NOT NULL DEFAULT 'DISCONNECTED',
    MODIFY `lastHeartbeat` DATETIME(3) NULL,
    MODIFY `lastSeen` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `ChargingSession` ADD COLUMN `commission` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `connectorId` VARCHAR(191) NULL,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `energyUsedWh` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `gracePeriodSec` INTEGER NULL,
    ADD COLUMN `graceStartedAt` DATETIME(3) NULL,
    ADD COLUMN `idTag` VARCHAR(191) NULL,
    ADD COLUMN `lastBilledWh` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `ownerEarning` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `pricePerKwh` DECIMAL(10, 2) NULL,
    ADD COLUMN `stopReason` ENUM('USER_REQUESTED', 'REMOTE_STOP', 'GRACE_EXPIRED', 'ZERO_BALANCE', 'CHARGER_FAULT', 'EMERGENCY_STOP', 'OTHER') NULL,
    ADD COLUMN `totalCost` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `userId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `firebaseUid` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `role` ENUM('CONSUMER', 'OWNER', 'ADMIN') NOT NULL DEFAULT 'CONSUMER',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_firebaseUid_key`(`firebaseUid`),
    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_phone_key`(`phone`),
    INDEX `User_firebaseUid_idx`(`firebaseUid`),
    INDEX `User_email_idx`(`email`),
    INDEX `User_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Wallet` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `balance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'LKR',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `Wallet_userId_key`(`userId`),
    INDEX `Wallet_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ledger` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('TOP_UP', 'CHARGE_DEBIT', 'REFUND', 'OWNER_EARNING', 'COMMISSION', 'SETTLEMENT_PAYOUT') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `balanceAfter` DECIMAL(12, 2) NOT NULL,
    `referenceId` VARCHAR(191) NULL,
    `referenceType` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Ledger_idempotencyKey_key`(`idempotencyKey`),
    INDEX `Ledger_userId_idx`(`userId`),
    INDEX `Ledger_type_idx`(`type`),
    INDEX `Ledger_referenceId_idx`(`referenceId`),
    INDEX `Ledger_createdAt_idx`(`createdAt`),
    INDEX `Ledger_idempotencyKey_idx`(`idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Pricing` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `pricePerKwh` DECIMAL(10, 2) NOT NULL,
    `commissionRate` DECIMAL(5, 2) NOT NULL DEFAULT 2.00,
    `gracePeriodSec` INTEGER NOT NULL DEFAULT 60,
    `lowBalanceThreshold` DECIMAL(10, 2) NOT NULL DEFAULT 50.00,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Pricing_isDefault_idx`(`isDefault`),
    INDEX `Pricing_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Station` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `latitude` DECIMAL(10, 8) NOT NULL,
    `longitude` DECIMAL(11, 8) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `pricingId` VARCHAR(191) NULL,
    `bookingEnabled` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Station_ownerId_idx`(`ownerId`),
    INDEX `Station_latitude_longitude_idx`(`latitude`, `longitude`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Connector` (
    `id` VARCHAR(191) NOT NULL,
    `chargerId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `status` ENUM('AVAILABLE', 'PREPARING', 'CHARGING', 'SUSPENDED_EV', 'SUSPENDED_EVSE', 'FINISHING', 'RESERVED', 'UNAVAILABLE', 'FAULTED') NOT NULL DEFAULT 'AVAILABLE',
    `errorCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Connector_chargerId_idx`(`chargerId`),
    UNIQUE INDEX `Connector_chargerId_connectorId_key`(`chargerId`, `connectorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Booking` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `startTime` DATETIME(3) NOT NULL,
    `expiryTime` DATETIME(3) NOT NULL,
    `status` ENUM('ACTIVE', 'USED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Booking_userId_idx`(`userId`),
    INDEX `Booking_connectorId_idx`(`connectorId`),
    INDEX `Booking_status_idx`(`status`),
    INDEX `Booking_startTime_idx`(`startTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Settlement` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `totalEarnings` DECIMAL(12, 2) NOT NULL,
    `totalCommission` DECIMAL(12, 2) NOT NULL,
    `netPayout` DECIMAL(12, 2) NOT NULL,
    `sessionCount` INTEGER NOT NULL DEFAULT 0,
    `totalEnergyWh` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'PROCESSING', 'PAID', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `paidAt` DATETIME(3) NULL,
    `paidByAdminId` VARCHAR(191) NULL,
    `paymentRef` VARCHAR(191) NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `paymentNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Settlement_ownerId_idx`(`ownerId`),
    INDEX `Settlement_status_idx`(`status`),
    INDEX `Settlement_periodStart_periodEnd_idx`(`periodStart`, `periodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GracePeriodJob` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `transactionId` VARCHAR(191) NOT NULL,
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
CREATE TABLE `OcppMessageLog` (
    `id` VARCHAR(191) NOT NULL,
    `chargerId` VARCHAR(191) NOT NULL,
    `direction` ENUM('INCOMING', 'OUTGOING') NOT NULL,
    `messageType` INTEGER NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NULL,
    `payload` TEXT NOT NULL,
    `response` TEXT NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorDescription` VARCHAR(191) NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `responseTime` INTEGER NULL,

    INDEX `OcppMessageLog_chargerId_idx`(`chargerId`),
    INDEX `OcppMessageLog_action_idx`(`action`),
    INDEX `OcppMessageLog_timestamp_idx`(`timestamp`),
    INDEX `OcppMessageLog_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SettlementItem` (
    `id` VARCHAR(191) NOT NULL,
    `settlementId` VARCHAR(191) NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `transactionId` VARCHAR(191) NOT NULL,
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

-- CreateTable
CREATE TABLE `AdminAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `previousValue` JSON NULL,
    `newValue` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAuditLog_adminId_idx`(`adminId`),
    INDEX `AdminAuditLog_action_idx`(`action`),
    INDEX `AdminAuditLog_targetType_targetId_idx`(`targetType`, `targetId`),
    INDEX `AdminAuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Charger_serialNumber_key` ON `Charger`(`serialNumber`);

-- CreateIndex
CREATE INDEX `Charger_stationId_idx` ON `Charger`(`stationId`);

-- CreateIndex
CREATE INDEX `Charger_serialNumber_idx` ON `Charger`(`serialNumber`);

-- CreateIndex
CREATE INDEX `Charger_status_idx` ON `Charger`(`status`);

-- CreateIndex
CREATE UNIQUE INDEX `ChargingSession_transactionId_key` ON `ChargingSession`(`transactionId`);

-- CreateIndex
CREATE INDEX `ChargingSession_userId_idx` ON `ChargingSession`(`userId`);

-- CreateIndex
CREATE INDEX `ChargingSession_transactionId_idx` ON `ChargingSession`(`transactionId`);

-- CreateIndex
CREATE INDEX `ChargingSession_startedAt_idx` ON `ChargingSession`(`startedAt`);

-- AddForeignKey
ALTER TABLE `Wallet` ADD CONSTRAINT `Wallet_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ledger` ADD CONSTRAINT `Ledger_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Station` ADD CONSTRAINT `Station_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Station` ADD CONSTRAINT `Station_pricingId_fkey` FOREIGN KEY (`pricingId`) REFERENCES `Pricing`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Charger` ADD CONSTRAINT `Charger_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `Station`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Connector` ADD CONSTRAINT `Connector_chargerId_fkey` FOREIGN KEY (`chargerId`) REFERENCES `Charger`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargingSession` ADD CONSTRAINT `ChargingSession_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `Connector`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargingSession` ADD CONSTRAINT `ChargingSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `Connector`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SettlementItem` ADD CONSTRAINT `SettlementItem_settlementId_fkey` FOREIGN KEY (`settlementId`) REFERENCES `Settlement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
