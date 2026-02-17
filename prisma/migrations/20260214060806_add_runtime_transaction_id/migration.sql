-- AlterTable
ALTER TABLE `chargerruntimestate` ADD COLUMN `transactionId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `ChargerRuntimeState_transactionId_idx` ON `ChargerRuntimeState`(`transactionId`);
