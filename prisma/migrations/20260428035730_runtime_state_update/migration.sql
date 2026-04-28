/*
  Warnings:

  - The primary key for the `chargerruntimestate` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE `chargerruntimestate` DROP PRIMARY KEY,
    ADD PRIMARY KEY (`chargerId`, `connectorId`);
