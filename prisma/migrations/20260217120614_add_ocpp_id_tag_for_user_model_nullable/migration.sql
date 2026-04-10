/*
  Warnings:

  - A unique constraint covering the columns `[ocppIdTag]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `User` ADD COLUMN `ocppIdTag` VARCHAR(20) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_ocppIdTag_key` ON `User`(`ocppIdTag`);
