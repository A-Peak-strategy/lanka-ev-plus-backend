-- Additive fields only. Existing sessions remain nullable so their in-flight
-- billing behaviour is preserved during the production rollout.
ALTER TABLE `ChargingSession`
    ADD COLUMN `pricingMode` VARCHAR(32) NULL,
    ADD COLUMN `basePricePerKwh` DECIMAL(10, 2) NULL,
    ADD COLUMN `lockedPricePerKwh` DECIMAL(10, 2) NULL,
    ADD COLUMN `membershipDiscountRate` DECIMAL(5, 2) NULL,
    ADD COLUMN `clientVersion` VARCHAR(64) NULL,
    ADD COLUMN `clientPlatform` VARCHAR(24) NULL;
