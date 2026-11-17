import { delay } from "@/mocks/delay";
import type { ZohoCallbackParams, ZohoCallbackResult } from "@/types/auth";

/**
 * Mock of TrackVid-BE `GET /api/mailboxes/zoho/callback` (TrackVid-FE forwards the Zoho query string there
 * and the backend redirects the browser). Same decisions as the backend handler:
 * `error` → connected=0&error=<error>; no `code` → authorization_code_missing;
 * no usable `state` → zoho_oauth_not_configured; otherwise connected=1.
 * The redirect target is the `callbackUrl` carried in `state` when it is a same-origin path, else
 * `/settings?tab=integrations`.
 */
const DEFAULT_CALLBACK = "/settings?tab=integrations";

/** `state` may carry `{ callbackUrl }` as base64 / base64url JSON. Anything else falls back to the default. */
function callbackFromState(state: string | null): string {
  if (!state) return DEFAULT_CALLBACK;
  try {
    const json = atob(state.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && "callbackUrl" in parsed && typeof parsed.callbackUrl === "string") {
      const url = new URL(parsed.callbackUrl, window.location.origin);
      if (url.origin === window.location.origin) return `${url.pathname}${url.search}`;
    }
  } catch {
    // Opaque or encrypted state (the real backend encrypts it): use the default integrations page.
  }
  return DEFAULT_CALLBACK;
}

function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base, window.location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

const zohoCallback = async (params: ZohoCallbackParams): Promise<ZohoCallbackResult> => {
  await delay(1200);
  const base = callbackFromState(params.state);
  const failWith = (error: string): ZohoCallbackResult => ({
    connected: false,
    error,
    mailbox: null,
    redirectTo: withParams(base, { connected: "0", error }),
  });
  if (params.error) return failWith(params.error);
  if (!params.code) return failWith("authorization_code_missing");
  if (!params.state) return failWith("zoho_oauth_not_configured");
  return { connected: true, error: null, mailbox: "support@urbanthreads.in", redirectTo: withParams(base, { connected: "1" }) };
};

export const OAuthService = {
  zohoCallback,
};
