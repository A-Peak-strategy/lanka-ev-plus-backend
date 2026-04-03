-- DropForeignKey
ALTER TABLE `ChargingSessionLive` DROP FOREIGN KEY `ChargingSessionLive_sessionId_fkey`;

-- DropIndex
DROP INDEX `ChargingSessionLive_transactionId_idx` ON `ChargingSessionLive`;

-- AlterTable
ALTER TABLE `ChargingSessionLive` MODIFY `transactionId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `ChargingSessionLive` ADD CONSTRAINT `ChargingSessionLive_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ChargingSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
