/*
  Warnings:

  - You are about to alter the column `transactionId` on the `graceperiodjob` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Int`.
  - You are about to alter the column `transactionId` on the `settlementitem` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Int`.

*/
-- AlterTable
ALTER TABLE `graceperiodjob` MODIFY `transactionId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `settlementitem` MODIFY `transactionId` INTEGER NOT NULL;
