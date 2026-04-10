-- AlterTable
ALTER TABLE `User` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `walletBalanceAtDeletion` DECIMAL(12, 2) NULL;

-- CreateIndex
CREATE INDEX `User_deletedAt_idx` ON `User`(`deletedAt`);
