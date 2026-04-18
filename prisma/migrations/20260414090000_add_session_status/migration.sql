-- AlterTable: Add session status column with default PENDING
ALTER TABLE `ChargingSession` ADD COLUMN `status` ENUM('PENDING', 'CHARGING', 'SUSPENDED', 'FINISHING', 'COMPLETED', 'FAULTED') NOT NULL DEFAULT 'PENDING';

-- Data Migration: Mark all existing completed sessions (endedAt IS NOT NULL) as COMPLETED
UPDATE `ChargingSession` SET `status` = 'COMPLETED' WHERE `endedAt` IS NOT NULL;

-- Data Migration: Mark any existing sessions that have a fault stop reason as FAULTED
UPDATE `ChargingSession` SET `status` = 'FAULTED' WHERE `stopReason` = 'CHARGER_FAULT' AND `endedAt` IS NOT NULL;

-- Data Migration: Mark any remaining active sessions (endedAt IS NULL) as CHARGING
-- These are sessions that were in progress when the migration runs
UPDATE `ChargingSession` SET `status` = 'CHARGING' WHERE `endedAt` IS NULL;

-- CreateIndex: Composite index for querying active sessions by user
CREATE INDEX `ChargingSession_userId_status_idx` ON `ChargingSession`(`userId`, `status`);
