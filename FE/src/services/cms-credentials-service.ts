import { clone, delay } from "@/mocks/delay";
import { sampleSessions } from "@/mocks/integrations";
import { UserService } from "@/services/user-service";
import { ecommerceAccountId, normalizePlatform, storedPasswordFor } from "@/services/tatMasterSetting-service";
import type {
  ApiResult,
  CompanyCredentialRow,
  CredentialSession,
  EcommerceProvider,
  IEcommerceAccountInfo,
  MyCompanyCredentialsResponse,
  RenewSessionPayload,
  SessionKey,
} from "@/types/integrations";

/**
 * Mock of the two TrackVid-FE `CmsService` calls the Integrations screen makes
 * (`GET /cms/my-company-credentials`, `POST /cms/renew-session`). They live here, not in
 * `cms-service.ts`, because the CMS route owns that file.
 */

/** Per-provider key the credentials endpoint nests the session under (Tata CLiQ has none). */
export const SESSION_KEY_BY_PROVIDER: Partial<Record<EcommerceProvider, SessionKey>> = {
  ajio: "ajioSession",
  meesho: "meeshoSession",
  snapdeal: "snapdealSession",
  myntra: "myntraSession",
  nykaa: "nykaaSession",
  flipkart: "flipkartSession",
  delhivery: "delhiverySession",
  xbees: "xbeesSession",
};

const COOKIES: Partial<Record<EcommerceProvider, string[]>> = {
  ajio: ["JSESSIONID", "sellerToken", "ajio_seller_profile", "__cf_bm"],
  meesho: ["connect.sid", "supplier_token"],
  snapdeal: ["SCOUTSESSIONID", "sd_seller"],
  myntra: ["at", "mynt-eupv", "_d_id"],
  nykaa: ["zoho_desk_sid", "nykaa_vendor"],
  flipkart: ["SN", "sellerAuth", "T"],
  delhivery: [],
  xbees: [],
};

let sessions: Record<string, CredentialSession | null> = clone(sampleSessions);

const isProvider = (key: string): key is EcommerceProvider => key in SESSION_KEY_BY_PROVIDER || key === "tatacliq";

/** Each credential of the company, bucketed by platform, with only that bucket's session key set. */
const getMyCompanyCredentials = async (): Promise<MyCompanyCredentialsResponse> => {
  await delay(450);
  const user = await UserService.getUser();
  const data: MyCompanyCredentialsResponse["data"] = {};
  for (const login of user.company.settings.eCommercePlatformLoginInfo ?? []) {
    const provider = normalizePlatform(login.eComPlatform);
    if (!isProvider(provider)) continue;
    const sessionKey = SESSION_KEY_BY_PROVIDER[provider];
    const rows: CompanyCredentialRow[] = login.info.map((acc: IEcommerceAccountInfo, i) => {
      const credentialId = ecommerceAccountId(login._id, i, acc);
      const row: CompanyCredentialRow = { credentialId, username: acc.username, is_verified: acc.is_verified };
      if (sessionKey) row[sessionKey] = clone(sessions[credentialId] ?? null);
      return row;
    });
    data[provider] = [...(data[provider] ?? []), ...rows];
  }
  return { isSuccess: true, data };
};

/**
 * Forces a fresh portal login for one credential and caches the session. TrackVid's takes 30-60 s;
 * the mock takes a few seconds. A credential whose stored password is wrong fails like the real one.
 */
const renewSession = async (payload: RenewSessionPayload): Promise<ApiResult> => {
  await delay(3500);
  const provider = normalizePlatform(payload.platform);
  if (!isProvider(provider) || !SESSION_KEY_BY_PROVIDER[provider]) {
    return { isSuccess: false, displayMessage: "Session renewal is not supported for this platform." };
  }
  const user = await UserService.getUser();
  const login = (user.company.settings.eCommercePlatformLoginInfo ?? []).find((l) => normalizePlatform(l.eComPlatform) === provider);
  const index = login?.info.findIndex((acc: IEcommerceAccountInfo, i) => ecommerceAccountId(login._id, i, acc) === payload.credentialId) ?? -1;
  if (!login || index < 0) return { isSuccess: false, displayMessage: "Credential not found." };
  const password = storedPasswordFor(payload.credentialId) ?? "";
  if (!login.info[index].is_verified || password.length < 6) {
    return { isSuccess: false, displayMessage: "Login failed: the portal rejected the username or password. Update it and Save All, then renew." };
  }
  const now = Date.now();
  sessions = {
    ...sessions,
    [payload.credentialId]: {
      savedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
      ip: "13.233.104.27",
      source: "renew-endpoint",
      cookieNames: COOKIES[provider] ?? [],
      ...(provider === "ajio" ? { userId: `SP-${login.info[index].vendorCode ?? "UT1029"}`, pobCount: 4 } : {}),
    },
  };
  return { isSuccess: true, displayMessage: `Session renewed for ${login.info[index].username}.` };
};

export const CmsCredentialsService = { getMyCompanyCredentials, renewSession };
