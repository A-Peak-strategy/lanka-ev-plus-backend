import { getCompatibilityFeatures } from "../config/features.js";

export const PricingMode = Object.freeze({
  LEGACY_FLAT: "LEGACY_FLAT",
  DYNAMIC_TOU: "DYNAMIC_TOU",
});

const MAX_VERSION_LENGTH = 64;
const MAX_PLATFORM_LENGTH = 24;

function cleanHeader(value, maxLength) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

export function parseClientCapabilities(value) {
  if (typeof value !== "string") return new Set();

  return new Set(
    value
      .split(",")
      .map((capability) => capability.trim().toLowerCase())
      .filter((capability) => /^[a-z0-9-]{1,64}$/.test(capability)),
  );
}

export function resolveClientCompatibility(headers = {}, features = getCompatibilityFeatures()) {
  const capabilities = parseClientCapabilities(headers["x-client-capabilities"]);
  const supportsTouPricing = capabilities.has("tou-pricing");
  const supportsMembershipPricing = capabilities.has("membership-pricing");

  const dynamicTouEnabled = supportsTouPricing
    ? features.enableTouForCapableClients
    : features.enableTouForLegacyClients && !features.legacyClientCompatibility;

  const pricingMode = dynamicTouEnabled
    ? PricingMode.DYNAMIC_TOU
    : PricingMode.LEGACY_FLAT;

  return {
    appVersion: cleanHeader(headers["x-app-version"], MAX_VERSION_LENGTH),
    platform: cleanHeader(headers["x-app-platform"], MAX_PLATFORM_LENGTH),
    capabilities: [...capabilities],
    pricingMode,
    applyMembershipPricing:
      pricingMode === PricingMode.DYNAMIC_TOU &&
      supportsMembershipPricing &&
      features.enableMembershipPricing,
  };
}

/**
 * Keeps all existing clients compatible: headers are optional and an absent
 * header resolves to the safe, flat-rate legacy mode.
 */
export function clientCompatibilityMiddleware(req, res, next) {
  req.clientCompatibility = resolveClientCompatibility(req.headers);
  next();
}
