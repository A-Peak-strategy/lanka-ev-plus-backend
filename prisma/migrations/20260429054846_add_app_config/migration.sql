-- CreateTable
CREATE TABLE `AppConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `latestAndroidVersion` VARCHAR(191) NOT NULL,
    `latestIosVersion` VARCHAR(191) NOT NULL,
    `minAndroidVersion` VARCHAR(191) NOT NULL,
    `minIosVersion` VARCHAR(191) NOT NULL,
    `forceUpdate` BOOLEAN NOT NULL DEFAULT false,
    `maintenanceMode` BOOLEAN NOT NULL DEFAULT false,
    `maintenanceMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
