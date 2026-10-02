/**
 * Runtime feature flags for backwards-compatible mobile releases.
 *
 * Flags are intentionally opt-in for new behaviour. A client without a
 * declared capability is always treated as a legacy client.
 */
function getBooleanEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

export function getCompatibilityFeatures() {
  return {
    legacyClientCompatibility: getBooleanEnv("LEGACY_CLIENT_COMPATIBILITY", true),
    enableTouForLegacyClients: getBooleanEnv("ENABLE_TOU_FOR_LEGACY_CLIENTS", false),
    enableTouForCapableClients: getBooleanEnv("ENABLE_TOU_FOR_CAPABLE_CLIENTS", true),
    enableMembershipPricing: getBooleanEnv("ENABLE_MEMBERSHIP_PRICING", true),
  };
}

export { getBooleanEnv };
