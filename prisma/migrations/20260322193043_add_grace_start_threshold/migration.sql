-- AlterTable
ALTER TABLE `Pricing` ADD COLUMN `graceStartThreshold` DECIMAL(10, 2) NOT NULL DEFAULT 100.00,
    MODIFY `lowBalanceThreshold` DECIMAL(10, 2) NOT NULL DEFAULT 300.00;
