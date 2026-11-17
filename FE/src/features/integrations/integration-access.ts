"use client";

import { useSelector } from "@/store";
import { INTEGRATION_KEYS, type IntegrationAccessMap, type IntegrationKey } from "@/types/integrations";

/**
 * Strict read of one key (TrackVid `hasIntegrationAccess`): anything but an explicit `true` is "no access".
 * Deny-by-default is the point of the flag, so never loosen this to a truthiness check.
 */
export function hasIntegrationAccess(access: IntegrationAccessMap | Record<string, boolean> | undefined | null, key: IntegrationKey): boolean {
  return access?.[key] === true;
}

export function isIntegrationKey(value: string | null | undefined): value is IntegrationKey {
  return !!value && (INTEGRATION_KEYS as readonly string[]).includes(value);
}

/** TrackVid `useIntegrationAccess`: per-card gate from `company.settings.integrationAccess`. */
export function useIntegrationAccess() {
  const access = useSelector((s) => s.profile.userProfile?.company.settings.integrationAccess);
  const enabledKeys = INTEGRATION_KEYS.filter((key) => hasIntegrationAccess(access, key));
  return {
    access,
    enabledKeys,
    enabledCount: enabledKeys.length,
    isEnabled: (key: IntegrationKey) => hasIntegrationAccess(access, key),
  };
}
