-- AlterTable
ALTER TABLE `ChargerRuntimeState` ADD COLUMN `bookingId` VARCHAR(191) NULL,
    ADD COLUMN `connectionStatus` ENUM('CONNECTED', 'DISCONNECTED') NULL,
    ADD COLUMN `errorCode` VARCHAR(191) NULL,
    ADD COLUMN `lastStatusUpdate` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `ChargerRuntimeState_connectionStatus_idx` ON `ChargerRuntimeState`(`connectionStatus`);
