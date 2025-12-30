/*
  Warnings:

  - You are about to drop the `chargingsession` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `chargingsession` DROP FOREIGN KEY `ChargingSession_chargerId_fkey`;

-- DropTable
DROP TABLE `chargingsession`;

-- CreateTable
CREATE TABLE `ChargingSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chargerId` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NOT NULL,
    `meterStartWh` INTEGER NULL,
    `meterStopWh` INTEGER NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,

    INDEX `ChargingSession_chargerId_idx`(`chargerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChargingSession` ADD CONSTRAINT `ChargingSession_chargerId_fkey` FOREIGN KEY (`chargerId`) REFERENCES `Charger`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
