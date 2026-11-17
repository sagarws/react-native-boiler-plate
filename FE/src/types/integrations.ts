/**
 * Integrations types, copied from TrackVid-FE (`api/whatsapp-service.ts`, `types/googleDrive.types.ts`,
 * `components/Integrations/sessionState.ts`, `components/Integrations/EcommerceAccountsSettings.tsx`).
 */

/* ---------------- integration access ---------------- */

/** Same keys (and `?provider=` slugs) as TrackVid `helper/integrationAccess.ts`. */
export const INTEGRATION_KEYS = [
  "email",
  "ajio",
  "meesho",
  "snapdeal",
  "myntra",
  "nykaa",
  "flipkart",
  "delhivery",
  "xbees",
  "tatacliq",
  "base",
  "11za",
  "mark360",
  "kwikengage",
] as const;

export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];
export type IntegrationAccessMap = Partial<Record<IntegrationKey, boolean>>;

/** Card status on /integrations. */
export type IntegrationStatus = "connected" | "available" | "enabled";

/* ---------------- WhatsApp ---------------- */

export type WhatsAppProvider = "11za" | "mark360" | "kwikengage";

export interface WhatsAppConnectionStatus {
  provider: WhatsAppProvider;
  connected: boolean;
  /** True when a row with credentials exists, whether or not it is the active provider. */
  configured?: boolean;
  businessAccountId?: string;
  businessAccountName?: string;
  phoneNumberId?: string;
  phoneNumber?: string;
  status?: "active" | "inactive" | "expired" | "error";
  lastConnectedAt?: string;
  accessToken?: string;
  templateName?: string;
  /** mark360 only */
  organizationId?: string;
  /** 11za only */
  originWebsite?: string;
  /** kwikengage only */
  merchantId?: string;
  metadata?: Record<string, unknown>;
}

/** `GET /whatsapp/active` */
export interface WhatsAppActiveResponse {
  isSuccess: boolean;
  activeProvider: WhatsAppProvider | null;
  configured: Record<WhatsAppProvider, boolean>;
  errored: Record<WhatsAppProvider, boolean>;
}

/** `GET /whatsapp/:provider/status` */
export interface WhatsAppStatusResponse {
  isSuccess: boolean;
  connection?: WhatsAppConnectionStatus;
}

/** connect / refresh-token / set-active / deactivate / disconnect */
export interface WhatsAppActionResponse {
  isSuccess: boolean;
  message?: string;
  connection?: WhatsAppConnectionStatus;
  /** disconnect only: provider promoted to active because the active one was removed. */
  promotedProvider?: WhatsAppProvider | null;
}

/* ---------------- Google Drive ---------------- */

export type GoogleDriveConnectionStatus = "not_connected" | "connected" | "token_expired";

/** `GET /drive/status` */
export interface GoogleDriveStatus {
  connected: boolean;
  status: GoogleDriveConnectionStatus;
  email?: string;
  name?: string;
  picture?: string;
  connectedAt?: string;
  rootFolderName: string;
  rootFolderUrl?: string | null;
}

/** `GET /drive/google/auth?callbackUrl=` */
export interface GoogleDriveAuthUrl {
  url: string;
}

/** Answer of the mocked Google consent screen (stands in for Google's redirect back to the BE). */
export interface GoogleConsentResult {
  account: string;
  allowDrive: boolean;
}

/* ---------------- Marketplace accounts ---------------- */

export type EcommerceProvider = "ajio" | "meesho" | "snapdeal" | "myntra" | "nykaa" | "flipkart" | "delhivery" | "xbees" | "tatacliq";

export type EcomPlatformCode = "AJIO" | "MEESHO" | "SNAPDEAL" | "MYNTRA" | "NYKAA" | "FLIPKART" | "DELHIVERY" | "XBEES" | "TATACLIQ";

/** One seller login stored in `company.settings.eCommercePlatformLoginInfo[].info[]`. */
export interface IEcommerceAccountInfo {
  _id?: string;
  username: string;
  password: string;
  is_verified: boolean;
  accountType?: string;
  vendorCode?: string;
  /** Meesho: the callback number claims are filed with. */
  phoneNumber?: string;
  /** Tata CLiQ: inbox Cloudflare Access mails its login code to ("" = default inbox). */
  cloudflareEmail?: string;
  visible?: boolean;
}

/** An account row on the marketplace settings screen. */
export interface IAccount extends IEcommerceAccountInfo {
  platform: string;
  accountType: string;
}

/** `POST /master-setting/ecom-logininfo-insup` */
export interface MasterTatSettingPayload {
  companyId: string;
  eCommercePlatformLoginInfo: { eComPlatform: string; info: IEcommerceAccountInfo[] }[];
}

/** `POST /master-setting/remove-ajio-account` */
export interface RemoveAccountPayload {
  companyId: string;
  accountId: string;
  eCommercePlatformLoginInfoId?: string;
}

/** `{ isSuccess, displayMessage }` body most TrackVid endpoints answer with. */
export interface ApiResult {
  isSuccess: boolean;
  displayMessage: string;
}

/* ---------------- Cached seller-portal sessions ---------------- */

/** Mirrors the DTO `/cms/my-company-credentials` emits (metadata only, never values). */
export interface CredentialSession {
  savedAt?: string | null;
  expiresAt?: string | null;
  ip?: string | null;
  source?: string | null;
  cookieNames?: string[];
  /** AJIO only: the seller's activeSellerProfileId. */
  userId?: string | null;
  /** AJIO only: how many POB IDs the login resolved. */
  pobCount?: number;
}

export type SessionKey =
  | "ajioSession"
  | "meeshoSession"
  | "snapdealSession"
  | "myntraSession"
  | "nykaaSession"
  | "flipkartSession"
  | "delhiverySession"
  | "xbeesSession";

export type CompanyCredentialRow = {
  credentialId: string;
  username: string;
  is_verified: boolean;
} & Partial<Record<SessionKey, CredentialSession | null>>;

/** `GET /cms/my-company-credentials` */
export interface MyCompanyCredentialsResponse {
  isSuccess: boolean;
  data: Partial<Record<EcommerceProvider, CompanyCredentialRow[]>>;
}

/** `POST /cms/renew-session` */
export interface RenewSessionPayload {
  platform: string;
  credentialId: string;
}

/* ---------------- E-commerce platforms (admin) ---------------- */

export interface IEcommercePlatformRecord {
  _id: string;
  name: string;
  logo?: string;
  tatPeriod: number;
  typeOfClaims: { name: string; description: string; key?: string; isDisable: boolean }[];
  isDeleted: boolean;
  createdAt: string;
}

export type CreateEcommercePlatformPayload = Pick<IEcommercePlatformRecord, "name" | "tatPeriod" | "typeOfClaims"> & { logo?: string };
export type UpdateEcommercePlatformPayload = Partial<CreateEcommercePlatformPayload> & { id: string };
