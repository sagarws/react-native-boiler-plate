import { clone, delay } from "@/mocks/delay";
import { sampleDriveStatus } from "@/mocks/integrations";
import { GOOGLE_DRIVE_ROOT_FOLDER_NAME } from "@/config/app-constant";
import type { GoogleConsentResult, GoogleDriveAuthUrl, GoogleDriveStatus } from "@/types/integrations";

/**
 * Mock of TrackVid-FE `api/googleDrive-service.ts` (`/drive`). The real flow sends the browser to
 * Google and the BE redirects back with `?driveConnected=1` or `?driveConnected=0&driveError=<code>`.
 * Here `getAuthUrl` returns a `mock-google-consent:` URL; the screen shows a consent dialog instead
 * and calls `completeConsent`, which answers with the same callback URL the BE would build.
 */

export const MOCK_CONSENT_PREFIX = "mock-google-consent:";

let status: GoogleDriveStatus = clone(sampleDriveStatus);

const getStatus = async (): Promise<GoogleDriveStatus> => {
  await delay(300);
  return clone(status);
};

/** Consent-screen URL. `callbackUrl` is where the browser comes back to after Google. */
const getAuthUrl = async (callbackUrl: string): Promise<GoogleDriveAuthUrl> => {
  await delay(400);
  return { url: `${MOCK_CONSENT_PREFIX}${encodeURIComponent(callbackUrl)}` };
};

const disconnect = async (): Promise<void> => {
  await delay(500);
  status = { rootFolderName: status.rootFolderName || GOOGLE_DRIVE_ROOT_FOLDER_NAME, connected: false, status: "not_connected" };
};

function withParams(callbackUrl: string, params: Record<string, string>): string {
  const url = new URL(callbackUrl, "http://mock.local");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return `${url.pathname}${url.search}`;
}

/**
 * Mock-only: what the BE OAuth callback does. Returns the in-app URL to navigate to, carrying the same
 * `driveConnected` / `driveError` params as TrackVid.
 */
const completeConsent = async (callbackUrl: string, result: GoogleConsentResult | null): Promise<string> => {
  await delay(600);
  if (!result) return withParams(callbackUrl, { driveConnected: "0", driveError: "access_denied" });
  if (!result.allowDrive) return withParams(callbackUrl, { driveConnected: "0", driveError: "drive_scope_not_granted" });
  status = {
    connected: true,
    status: "connected",
    email: result.account,
    name: result.account.split("@")[0].replace(/[._]/g, " "),
    connectedAt: new Date().toISOString(),
    rootFolderName: GOOGLE_DRIVE_ROOT_FOLDER_NAME,
    rootFolderUrl: "https://drive.google.com/drive/folders/1sCaNaNdPaCkUrBaNtHrEaDs",
  };
  return withParams(callbackUrl, { driveConnected: "1" });
};

export const GoogleDriveService = {
  getStatus,
  getAuthUrl,
  disconnect,
  completeConsent,
};
