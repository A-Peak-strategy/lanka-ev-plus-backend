/*
  Warnings:

  - You are about to alter the column `transactionId` on the `chargingsession` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Int`.
  - You are about to alter the column `transactionId` on the `graceperiodjob` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Int`.
  - You are about to alter the column `transactionId` on the `settlementitem` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Int`.

*/
-- AlterTable
ALTER TABLE `chargingsession` MODIFY `transactionId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `graceperiodjob` MODIFY `transactionId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `settlementitem` MODIFY `transactionId` INTEGER NOT NULL;

-- CreateTable
CREATE TABLE `ChargingSessionLive` (
    `id` VARCHAR(191) NOT NULL,
    `transactionId` INTEGER NOT NULL,
    `sessionId` INTEGER NOT NULL,
    `chargerId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `energyWh` INTEGER NOT NULL,
    `powerW` INTEGER NULL,
    `voltageV` DOUBLE NULL,
    `currentA` DOUBLE NULL,
    `socPercent` INTEGER NULL,
    `temperatureC` DOUBLE NULL,
    `lastMeterAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ChargingSessionLive_transactionId_key`(`transactionId`),
    UNIQUE INDEX `ChargingSessionLive_sessionId_key`(`sessionId`),
    INDEX `ChargingSessionLive_transactionId_idx`(`transactionId`),
    INDEX `ChargingSessionLive_chargerId_idx`(`chargerId`),
    INDEX `ChargingSessionLive_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChargingSessionLive` ADD CONSTRAINT `ChargingSessionLive_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ChargingSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
