import { daysAgo } from "@/mocks/delay";
import { samplePlatforms } from "@/mocks/user";
import { GOOGLE_DRIVE_ROOT_FOLDER_NAME } from "@/config/app-constant";
import type {
  CredentialSession,
  GoogleDriveStatus,
  IEcommercePlatformRecord,
  WhatsAppConnectionStatus,
  WhatsAppProvider,
} from "@/types/integrations";

/** Sample data for /integrations (WhatsApp, Google Drive, cached marketplace sessions). */

/** WhatsApp rows: Mark360 live, KwikEngage set up but its key expired, 11za never set up. */
export const sampleWhatsAppConnections: Record<WhatsAppProvider, WhatsAppConnectionStatus | null> = {
  mark360: {
    provider: "mark360",
    connected: true,
    configured: true,
    businessAccountName: "Urban Threads Support",
    phoneNumber: "+91 98765 43210",
    status: "active",
    lastConnectedAt: daysAgo(18),
    templateName: "video_link",
    organizationId: "69bd1cf544cb180aaf0b47c3",
  },
  kwikengage: {
    provider: "kwikengage",
    connected: false,
    configured: true,
    businessAccountName: "Urban Threads Orders",
    phoneNumber: "+91 99250 11223",
    status: "expired",
    lastConnectedAt: daysAgo(64),
    templateName: "order_video_update",
    merchantId: "6a0703f7314c64d443286f51",
  },
  "11za": null,
};

export const sampleActiveWhatsAppProvider: WhatsAppProvider | null = "mark360";

export const sampleDriveStatus: GoogleDriveStatus = {
  connected: true,
  status: "connected",
  email: "ops@urbanthreads.in",
  name: "Urban Threads Ops",
  connectedAt: daysAgo(41),
  rootFolderName: GOOGLE_DRIVE_ROOT_FOLDER_NAME,
  rootFolderUrl: "https://drive.google.com/drive/folders/1sCaNaNdPaCkUrBaNtHrEaDs",
};

/** Google accounts offered on the mocked consent screen. */
export const sampleGoogleAccounts = ["ops@urbanthreads.in", "aarav@urbanthreads.in", "warehouse.surat@gmail.com"];

const inDays = (days: number) => daysAgo(-days);

/**
 * Cached seller-portal login sessions keyed by credential id. Ids of accounts that were never saved
 * with an explicit `_id` are `<loginInfoId>-<index>` (see `ecommerceAccountId`).
 */
export const sampleSessions: Record<string, CredentialSession | null> = {
  "cred0000000000000000001-0": {
    savedAt: daysAgo(1, 9),
    expiresAt: inDays(2),
    ip: "103.21.58.14",
    source: "renew-endpoint",
    cookieNames: ["JSESSIONID", "sellerToken", "ajio_seller_profile", "__cf_bm"],
    userId: "SP-UT1029",
    pobCount: 4,
  },
  "cred0000000000000000002-0": {
    savedAt: daysAgo(12),
    expiresAt: daysAgo(5),
    ip: "103.21.58.14",
    source: "chrome-extension",
    cookieNames: ["at", "mynt-eupv", "_d_id"],
  },
  "cred0000000000000000003-0": null,
};

/** Stored marketplace passwords (never sent to the screen; `getEcommerceCredentials` masks them). */
export const sampleAccountPasswords: Record<string, string> = {
  "cred0000000000000000001-0": "Ajio@2024",
  "cred0000000000000000002-0": "mynt",
  "cred0000000000000000003-0": "Flip@kart9",
};

export const sampleEcommercePlatformRecords: IEcommercePlatformRecord[] = samplePlatforms.map((p, i) => ({
  _id: p._id ?? `plat${String(i + 1).padStart(20, "0")}`,
  name: p.name,
  logo: undefined,
  tatPeriod: p.tatPeriod,
  typeOfClaims: p.typeOfClaims.map((c) => ({ ...c })),
  isDeleted: false,
  createdAt: daysAgo(400 - i * 20),
}));
