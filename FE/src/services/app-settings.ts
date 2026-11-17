import { DefaultECommercePlatforms } from "@/config/constant";
import { clone, delay } from "@/mocks/delay";
import { sampleAppSetting } from "@/mocks/settings";
import type { IAppSetting, IClaimTypes } from "@/types/settings";

/**
 * Mock of TrackVid-FE `api/app-settings.ts` (`/app-settings`). Both functions return the body's `data`.
 * The app-level settings are read-only from the seller UI (only the system admin edits them).
 */

/** `GET /app-settings/get-app-setting-for-admin`: credit rates, Increff QC mapping and SPF TAT defaults. */
const getAppSettings = async (): Promise<IAppSetting> => {
  await delay();
  return clone(sampleAppSetting);
};

/** `GET /app-settings/claim-types`: only the default claim catalogue per marketplace. */
const getClaimTypes = async (): Promise<IClaimTypes> => {
  await delay();
  return { eCommercePlatform: clone(DefaultECommercePlatforms) };
};

export const AppSettingsService = {
  getAppSettings,
  getClaimTypes,
};
