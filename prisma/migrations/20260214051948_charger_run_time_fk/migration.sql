/*
  Warnings:

  - You are about to alter the column `internalTransactionId` on the `chargerruntimestate` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Int`.

*/
-- DropIndex
DROP INDEX `ChargingSessionLive_transactionId_key` ON `chargingsessionlive`;

-- AlterTable
ALTER TABLE `chargerruntimestate` MODIFY `internalTransactionId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `ChargingSessionLive_transactionId_idx` ON `ChargingSessionLive`(`transactionId`);
