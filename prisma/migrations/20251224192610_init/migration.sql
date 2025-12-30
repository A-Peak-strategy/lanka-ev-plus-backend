-- CreateTable
CREATE TABLE `Charger` (
    `id` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `firmwareVersion` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `connectionState` VARCHAR(191) NOT NULL,
    `lastHeartbeat` DATETIME(3) NOT NULL,
    `lastSeen` DATETIME(3) NOT NULL,
    `totalEnergyWh` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChargingSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chargerId` VARCHAR(191) NOT NULL,
    `transactionId` INTEGER NOT NULL,
    `meterStartWh` INTEGER NOT NULL,
    `meterStopWh` INTEGER NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,

    INDEX `ChargingSession_chargerId_idx`(`chargerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChargingSession` ADD CONSTRAINT `ChargingSession_chargerId_fkey` FOREIGN KEY (`chargerId`) REFERENCES `Charger`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
