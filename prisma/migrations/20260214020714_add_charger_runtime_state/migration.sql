-- DropForeignKey
ALTER TABLE `ChargingSessionLive` DROP FOREIGN KEY `ChargingSessionLive_sessionId_fkey`;

-- CreateTable
CREATE TABLE `ChargerRuntimeState` (
    `chargerId` VARCHAR(191) NOT NULL,
    `connectorId` INTEGER NOT NULL,
    `status` ENUM('AVAILABLE', 'PREPARING', 'CHARGING', 'SUSPENDED_EV', 'SUSPENDED_EVSE', 'FINISHING', 'RESERVED', 'UNAVAILABLE', 'FAULTED') NOT NULL,
    `internalTransactionId` VARCHAR(191) NULL,
    `ocppTransactionId` INTEGER NULL,
    `idTag` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `meterStartWh` INTEGER NULL,
    `lastMeterValueWh` INTEGER NULL,
    `sessionStartTime` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ChargerRuntimeState_internalTransactionId_key`(`internalTransactionId`),
    INDEX `ChargerRuntimeState_chargerId_idx`(`chargerId`),
    INDEX `ChargerRuntimeState_ocppTransactionId_idx`(`ocppTransactionId`),
    INDEX `ChargerRuntimeState_status_idx`(`status`),
    PRIMARY KEY (`chargerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChargingSessionLive` ADD CONSTRAINT `ChargingSessionLive_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `ChargingSession`(`transactionId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChargerRuntimeState` ADD CONSTRAINT `ChargerRuntimeState_chargerId_fkey` FOREIGN KEY (`chargerId`) REFERENCES `Charger`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
