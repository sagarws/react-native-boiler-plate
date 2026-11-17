/**
 * Types for the AJIO email automation and connected mailboxes.
 * Same field names as TrackVid-FE `api/email-automation-service.ts`, `api/mailbox-service.ts`,
 * `types/mailbox.types.ts` and the local types in `components/email/EmailInbox.tsx`.
 */

// ─── Emails ────────────────────────────────────────────────────────────────

export type EmailStatusFilter = "pending" | "replied";

export type EmailStatus = "new" | "fetched" | "replied" | "error" | "manually_replied";

export type ManualFixType = "awb" | "video_link";

export interface EmailManualFix {
  type: ManualFixType;
  customerOrderNo?: string;
  awb?: string;
  previousOrderNo?: string | null;
  videoLink?: string;
  by?: string;
  at?: string;
}

export interface EmailReplyDetail {
  subject?: string;
  body?: string;
  bodyRaw?: string;
  repliedAt?: string;
  errorMessage?: string;
  errorCode?: string;
  to?: string;
  cc?: string;
}

export interface EmailRow {
  _id: string;
  subject: string;
  sender: { name?: string; email: string };
  status: EmailStatus;
  receivedAt: string;
  matchingPattern: string;
  snippet?: string;
  body?: string;
  bodyRaw?: string;
  retryAttempts?: number;
  mailboxId?: string;
  replyDetail?: EmailReplyDetail | null;
  meta?: Record<string, unknown>;
  ajioAcknowledgementReplied?: boolean;
  ajioAcknowledgementAt?: string;
  manualFix?: EmailManualFix;
}

export interface EmailSection {
  items: EmailRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface EmailOverview {
  pending: EmailSection;
  replied: EmailSection;
}

export interface EmailStatRecord {
  key?: string;
  label?: string;
  value?: number;
  count?: number;
  total?: number;
  helper?: string;
}

/** Body of `GET /emails/stats/today` (the shape DashboardMaster / DashboardInsightsRow read). */
export interface EmailTodayStats {
  totalSent: number;
  replied: number;
  failed: number;
  manual: number;
}

export interface EmailListParams {
  pendingPage: number;
  repliedPage: number;
  pageSize: number;
  mailboxId?: string;
  startDate?: string;
  endDate?: string;
  timezone?: string;
}

export interface EmailCountParams {
  mailboxId?: string;
  pendingStartDate?: string;
  pendingEndDate?: string;
  repliedStartDate?: string;
  repliedEndDate?: string;
  timezone?: string;
}

export interface EmailListByStatusParams {
  status: EmailStatusFilter;
  page: number;
  pageSize: number;
  mailboxId?: string;
  startDate?: string;
  endDate?: string;
  timezone?: string;
}

export interface EmailCountResponse {
  pending: { total: number };
  replied: { total: number };
}

export interface EmailExportParams {
  status: EmailStatusFilter;
  mailboxId?: string;
  startDate?: string;
  endDate?: string;
  timezone?: string;
  scope?: "page" | "all";
  page?: number;
  pageSize?: number;
}

export interface EmailDetailsResponse {
  _id: string;
  body?: string;
  bodyRaw?: string;
  meta?: Record<string, unknown>;
  replyDetail?: { body?: string; bodyRaw?: string; repliedAt?: string; errorMessage?: string } | null;
}

export interface EmailRetryBulkResponse {
  enqueued: number;
  skipped: number;
  breakdown: Record<string, number>;
  details: Array<{ emailId: string; reason: string; currentStatus?: string }>;
  enqueuedIds?: string[];
}

export interface EmailActionResponse {
  message: string;
  email: EmailRow;
}

// ─── Manual fix for failed AJIO replies ────────────────────────────────────

export interface ManualFixIssue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ManualFixContext {
  emailId: string;
  customerOrderNo: string | null;
  customerOrderNoFromEmail: boolean;
  manualFix: EmailManualFix | null;
}

export interface AwbPreview {
  emailId: string;
  customerOrderNo: string | null;
  customerOrderNoFromEmail: boolean;
  awb: string;
  order: { trackingId: string; orderNo: string | null; createdAt?: string } | null;
  hasVideo: boolean;
  videoUrl: string | null;
  evaluation: { canLink: boolean; blockers: ManualFixIssue[]; warnings: ManualFixIssue[] };
}

export interface ManualFixSendResult {
  fixSaved: true;
  sent: boolean;
  status: "replied" | "error";
  error?: { code?: string; message: string };
  manualFix: EmailManualFix;
  preview?: AwbPreview;
}

/** 4xx body from the manual-fix endpoints. */
export interface ManualFixErrorBody {
  error: string;
  displayMessage?: string;
  code: string;
  preview?: AwbPreview;
}

export type ManualFixResponse<T> = { ok: true; data: T } | { ok: false; status: number; body: ManualFixErrorBody };

// ─── Mailboxes ─────────────────────────────────────────────────────────────

export type MailboxAuthType = "oauth" | "password";
export type MailboxProvider = "google" | "outlook" | "yahoo" | "zoho" | "other";
export type MailboxStatus = "connected" | "error" | "token_expired";

export interface Mailbox {
  _id: string;
  userId: string;
  email: string;
  displayName?: string;
  authType: MailboxAuthType;
  provider: MailboxProvider;
  type?: "enterprise" | "personal";
  status: MailboxStatus;
  config: { imapHost: string; imapPort?: number; smtpHost: string; smtpPort?: number };
  inboxSync?: { lastSyncedAt: string };
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MailboxListResponse {
  mailboxes: Mailbox[];
}

export interface MailboxStatusCheck {
  hasMailboxes: boolean;
  hasDisconnected: boolean;
  disconnectedCount: number;
  totalCount: number;
}

export interface ProviderConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export interface ProviderInfo {
  name: string;
  link: string;
  instructions: string;
  config?: ProviderConfig;
}

export interface TestConnectionRequest {
  email: string;
  password: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
}

export interface TestConnectionResponse {
  success: boolean;
  message?: string;
  error?: string;
  details?: string;
  field?: "imap" | "smtp";
}

export interface AddPasswordMailboxRequest {
  email: string;
  password: string;
  displayName?: string;
  provider: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
}

export interface AddPasswordMailboxResponse {
  success: boolean;
  mailbox: Mailbox;
  message?: string;
}

export interface UpdatePasswordRequest {
  password: string;
}

export interface UpdatePasswordResponse {
  success: boolean;
  message: string;
}

export interface ProviderConfigResponse {
  success: boolean;
  config: ProviderConfig;
  instructions?: string;
}

export interface MailboxLogEntry {
  id?: string;
  _id?: string;
  mailboxId: string;
  type: string;
  event: string;
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
  level?: string;
  errorDetails?: unknown;
  updatedAt?: string;
}

export interface MailboxLogResponse {
  data: MailboxLogEntry[];
  pagination: { page: number; pageSize: number; totalPages: number; totalItems: number };
}

export interface MailboxLogQuery {
  page?: number;
  pageSize?: number;
  type?: string;
  event?: string;
}

export interface ZohoSettings {
  configured: boolean;
  clientId: string;
  location: string;
  /** Callback URL that will be sent to Zoho — must match the console entry exactly. */
  redirectUri: string;
  /** What the server derives from BASE_URL, offered as a reset default. */
  suggestedRedirectUri: string;
  /** Whether a secret is already on file — the secret itself is never returned. */
  hasClientSecret: boolean;
}

export interface ZohoConnectPayload {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  location: string;
  callbackUrl: string;
}

export interface ManualSyncResult {
  mailboxId: string;
  provider: string;
  email: string;
  fetchedCount: number;
  unrepliedCount: number;
  lastSyncedAt: string | null;
  /** Messages the provider search returned, before TrackVid's own filters. */
  scanned: number;
  /** Skip reason → count, explaining the gap between `scanned` and `fetchedCount`. */
  skipped: Record<string, number>;
  effectiveSince?: string;
  statusWritesAllowed: boolean;
}

export type MailFetchFolder = "inbox" | "allMail";

export interface MailFetchFolderResponse {
  mailFetchFolder: MailFetchFolder;
  options: MailFetchFolder[];
}

export interface DataEnvelope<T> {
  data: T;
  displayMessage?: string;
}
