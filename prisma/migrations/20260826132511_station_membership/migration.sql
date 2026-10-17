-- AlterTable
ALTER TABLE `pricing` ADD COLUMN `dayPrice` DECIMAL(10, 2) NULL,
    ADD COLUMN `isTouEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `offPeakPrice` DECIMAL(10, 2) NULL,
    ADD COLUMN `peakPrice` DECIMAL(10, 2) NULL;
