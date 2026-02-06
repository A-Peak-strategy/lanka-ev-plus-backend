/*
  Warnings:

  - You are about to alter the column `transactionId` on the `chargingsession` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Int`.

*/
-- AlterTable
ALTER TABLE `chargingsession` MODIFY `transactionId` INTEGER NOT NULL;
