-- DropForeignKey
ALTER TABLE `ChargingSessionLive` DROP FOREIGN KEY `ChargingSessionLive_transactionId_fkey`;

-- AddForeignKey
ALTER TABLE `ChargingSessionLive` ADD CONSTRAINT `ChargingSessionLive_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ChargingSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
