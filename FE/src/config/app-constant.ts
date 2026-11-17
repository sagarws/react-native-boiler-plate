/** TrackVid-FE `config/constant.ts` (unchanged except: no Vite env, no live download URL in UI-only mode). */
export const ENV_PRODUCTION = "production";
export const ENV_DEVELOPMENT = "dev";

export const LOCALSTORAGE_USER_AUTH_TOKEN_KEY = "user-token";
export const LOCALSTORAGE_USER_AUTH_DETAILS_KEY = "user-details";
export const THEME = "theme";

export const SERVER_AUTH_ERROR_STATUS_CODE = 401;
export const SERVER_VALIDATION_STATUS_CODE = 400;
export const GENERIC_ERROR_MESSAGE = "Something went wrong! Please try again later.";

export const ORDER_TYPE: {
  FORWARD: string;
  RETURN: string;
} = {
  FORWARD: "Forward",
  RETURN: "Return",
};

export const COLUMN_RESIZE: string = "columnResize"

export const CLAIM_HISTORY_ACTION_TYPE = {
  CMS_CREATED: 1,
  EMAIL_TEMPLATE_UPDATED: 2,
  TICKET_ADDED: 3,
  TICKET_UPDATED: 4,
  STATUS_CHANGED_FROM_PENDING_TO_IN_REVIEW: 5,
  STATUS_CHANGED_FROM_IN_REVIEW_TO_APPROVED: 6,
  STATUS_CHANGED_FROM_IN_REVIEW_TO_REJECTED: 7,
  STATUS_CHANGED_FROM_APPROVED_TO_IN_REVIEW: 8,
  STATUS_CHANGED_FROM_APPROVED_TO_REJECTED: 9,
  STATUS_CHANGED_FROM_APPROVED_TO_PENDING: 10,
  STATUS_CHANGED_FROM_REJECTED_TO_IN_REVIEW: 11,
  STATUS_CHANGED_FROM_REJECTED_TO_APPROVED: 12,
  STATUS_CHANGED_FROM_REJECTED_TO_PENDING: 13,
  STATUS_CHANGED_FROM_IN_REVIEW_TO_PENDING: 14,

  // Order Statuses
  SHIPPED: 15,
  CANCELLED: 16,

  // Return Created Cases
  RETURN_CREATED_NOT_NEAR: 17, // Order added, status is Return Created, but video remove date is NOT near
  RETURN_CREATED_REMOVAL_DUE: 18, // Order added, status is Return Created, and video remove date is near (+30 days)

  // Return Created → Return Cancelled
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_CANCELLED: 19,

  // Return Created → Return Delivered (with 4 sub-statuses)
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DELIVERED_PENDING: 20,
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DELIVERED_PENDING_REMOVAL_DUE: 21, // Remove date near (+30 days)
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DELIVERED_IN_REVIEW_NOT_NEAR: 22,
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DELIVERED_IN_REVIEW_REMOVAL_DUE: 23, // Remove date near (+30 days)
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DELIVERED_APPROVED: 24,
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DELIVERED_REJECTED: 25,

  // Return Created → Return Not Delivered
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_NOT_DELIVERED_REMOVAL_DUE: 26, // Remove date near (+30 days)

  // Return Created → Return Dispute (with 4 sub-statuses)
  // STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DISPUTE_PENDING: 13,
  // STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DISPUTE_PENDING_REMOVAL_DUE: 14,  // Remove date near (+30 days)
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DISPUTE_IN_REVIEW_NOT_NEAR: 27,
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DISPUTE_IN_REVIEW_REMOVAL_DUE: 28, // Remove date near (+30 days)
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DISPUTE_APPROVED: 29,
  STATUS_CHANGED_RETURN_CREATED_TO_RETURN_DISPUTE_REJECTED: 30,
};

export const CREDIT_HISTORY_ACTION_TYPE = {
	VMS_CREATED: 1,
	CMS_CREATED: 2,
	CREDIT_PURCHASED: 3,
	BONUS_ADDED: 4,
	REFUND_ADDED: 5,
	REVOKE_CREDIT: 6,
	FAVORITE_VMS_CREDIT: 7,
	VALIDITY_EXTENDED: 8,
	EXTRA_BONUS_ADDED: 9,
	EXTRA_BONUS_REVOKED: 10,
	CREDIT_DEDUCTED: 11,
	CMS_VIDEO_UPLOADED: 12,
};

export const ACTION_FINDER: {[key: number]: string}= {
  1: "VMS Created",
  2: "CMS Created",
  3: "Credit Purchased",
  4: "Bonus Added",
  5: "Refund Added",
  6: "Revoke Credit",
  7: "Favorite VMS Credit",
  8: "Validity Extended",
  9: "Extra Bonus Added",
  10: "Extra Bonus Revoked",
  11: "Credit Deducted",
  12: "CMS Video Uploaded",
};

export const TICKET_STATUS = {
  PROCESS: 1,
  COMPLETED:2
};

export enum HISTORY_TYPE_ENUM {
  CLAIM = "claim",
  MASTER_ORDER = "master_order",
}
// Google Drive (user's own Drive — Scan & Pack PDF storage). The BE OAuth
// callback lands the browser back on the page that started the connect with
// these query params.
export const GOOGLE_DRIVE_QUERY_CONNECTED = "driveConnected";
export const GOOGLE_DRIVE_QUERY_ERROR = "driveError";
export const GOOGLE_DRIVE_ROOT_FOLDER_NAME = "scan-and-pack";
// Only this week's and last week's Scan & Pack folders are kept in Drive; the
// BE cron deletes the week before last (TrackVid-BE weekFolder.ts).
export const GOOGLE_DRIVE_RETENTION_TEXT =
  "Only this week's and last week's folders are kept — older week folders are deleted automatically.";
export const GOOGLE_DRIVE_CONNECTED_MESSAGE = "Google Drive connected.";
export const GOOGLE_DRIVE_DISCONNECTED_MESSAGE = "Google Drive disconnected.";
export const GOOGLE_DRIVE_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Google Drive access was not allowed.",
  drive_scope_not_granted:
    "Google Drive permission was not ticked on the Google consent screen. Please connect again and allow Drive access.",
  drive_oauth_not_configured: "Google Drive sign-in is not set up on the server yet.",
  oauth_state_invalid: "That Google sign-in link expired. Please connect again.",
  refresh_token_missing: "Google did not grant offline access. Please connect again.",
  drive_api_disabled:
    "Google Drive API is turned off for this app's Google Cloud project. In Google Cloud Console open APIs & Services → Library → Google Drive API → Enable, wait a minute, then connect again.",
  drive_setup_failed:
    "Connected, but the scan-and-pack folder could not be created in Google Drive. Check that the Google Drive API is enabled on the Google Cloud project, then connect again.",
};
export const GOOGLE_DRIVE_GENERIC_ERROR = "Could not connect Google Drive. Please try again.";

// CMS desktop app. The server answers with Content-Disposition: attachment,
// so following this link downloads the installer without leaving the page.
export const CMS_APP_DOWNLOAD_URL = "#cms-app-download";
export const CMS_APP_INSTALL_MESSAGE =
  "For a smoother claim process, we have developed the CMS app. Please install it by clicking the link below.";
export const CMS_APP_INSTALL_LINK_TEXT = "Click here to install the CMS app";
// The CMS app guide ships with this app (public/cms-guide/, copied from
// Trackvid-CMS/docs/guide/dist). Opened in a new tab.
export const CMS_APP_GUIDE_URL = "/cms-guide/index.html";
export const CMS_APP_GUIDE_LINK_TEXT = "View CMS app guide";
export const WHATS_NEW_WALKTHROUGH_TEXT = "View walkthrough";

// Tata CliQ Cloudflare Access inbox. MUST stay identical to the BE check in
// TrackVid-BE masterImportSetting.controller.ts (`cfEmail`): the BE stores any
// value failing it as "" without an error, so the form rejects it first rather
// than letting Save "succeed" and the inbox silently vanish.
export const CLOUDFLARE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CLOUDFLARE_EMAIL_INVALID_TEXT = "Enter a full email address, e.g. name@yourcompany.com.";
export const CLOUDFLARE_EMAIL_HELPER_TEXT = "Inbox for the Cloudflare login code. Empty uses the default.";
export const CLOUDFLARE_EMAIL_SAVE_ERROR =
  "Fix the Cloudflare Access email on the highlighted account(s) before saving.";

/** True when the Cloudflare Access email is empty (use default inbox) or valid. */
export const isCloudflareEmailValid = (value?: string): boolean => {
  const trimmed = (value || "").trim();
  return trimmed === "" || CLOUDFLARE_EMAIL_PATTERN.test(trimmed);
};
