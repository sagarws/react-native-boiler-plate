import { clone, delay, newId } from "@/mocks/delay";
import { AJIO_SENDER, buildClaimBody, emailDb } from "@/mocks/emails";
import type {
  AddPasswordMailboxRequest,
  AddPasswordMailboxResponse,
  DataEnvelope,
  MailFetchFolder,
  MailFetchFolderResponse,
  Mailbox,
  MailboxListResponse,
  MailboxLogEntry,
  MailboxLogQuery,
  MailboxLogResponse,
  MailboxProvider,
  MailboxStatusCheck,
  ManualSyncResult,
  ProviderConfig,
  ProviderConfigResponse,
  TestConnectionRequest,
  TestConnectionResponse,
  UpdatePasswordRequest,
  UpdatePasswordResponse,
  ZohoConnectPayload,
  ZohoSettings,
} from "@/types/emails";

/**
 * Mock of TrackVid-FE `api/mailbox-service.ts` (`/mailboxes/*`, `/mailbox/password/*`). Same function
 * names; each resolves with the response body. Settings (IntegrationsSettings) also uses this.
 */

const USER_ID = "64f0c0ffee0000000000a001";
const FETCH_FOLDER_OPTIONS: MailFetchFolder[] = ["inbox", "allMail"];

const PROVIDER_CONFIGS: Record<MailboxProvider, ProviderConfig> = {
  google: { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465 },
  outlook: { imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp.office365.com", smtpPort: 587 },
  yahoo: { imapHost: "imap.mail.yahoo.com", imapPort: 993, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465 },
  zoho: { imapHost: "imap.zoho.com", imapPort: 993, smtpHost: "smtp.zoho.com", smtpPort: 465 },
  other: { imapHost: "", imapPort: 993, smtpHost: "", smtpPort: 465 },
};

/** Test-connection failure with the field the server blames (`imap` / `smtp`), like the BE 400 body. */
export class MailboxConnectionError extends Error {
  readonly field?: "imap" | "smtp";
  readonly details: string;
  constructor(details: string, field?: "imap" | "smtp") {
    super(details);
    this.name = "MailboxConnectionError";
    this.field = field;
    this.details = details;
  }
}

function findMailbox(mailboxId: string): Mailbox {
  const mb = emailDb.mailboxes.find((m) => m._id === mailboxId);
  if (!mb) throw new Error("Mailbox not found.");
  return mb;
}

function patchMailbox(mailboxId: string, patch: Partial<Mailbox>): Mailbox {
  emailDb.mailboxes = emailDb.mailboxes.map((m) => (m._id === mailboxId ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m));
  return findMailbox(mailboxId);
}

function addLog(mailboxId: string, type: "activity" | "error", event: string, message: string, metadata?: Record<string, unknown>): void {
  const entry: MailboxLogEntry = { id: newId(), mailboxId, type, event, message, createdAt: new Date().toISOString(), metadata };
  emailDb.logs = [entry, ...emailDb.logs];
}

const checkMailboxStatus = async (): Promise<MailboxStatusCheck> => {
  await delay(250);
  const total = emailDb.mailboxes.length;
  const disconnected = emailDb.mailboxes.filter((m) => m.status !== "connected").length;
  return { hasMailboxes: total > 0, hasDisconnected: disconnected > 0, disconnectedCount: disconnected, totalCount: total };
};

const listMailboxes = async (): Promise<MailboxListResponse> => {
  await delay();
  return { mailboxes: clone(emailDb.mailboxes) };
};

const removeMailbox = async (mailboxId: string): Promise<{ message: string }> => {
  await delay(500);
  findMailbox(mailboxId);
  emailDb.mailboxes = emailDb.mailboxes.filter((m) => m._id !== mailboxId);
  return { message: "Mailbox removed" };
};

const getMailboxLogs = async (mailboxId: string, q: MailboxLogQuery = {}): Promise<MailboxLogResponse> => {
  await delay();
  if (!emailDb.mailboxes.some((m) => m._id === mailboxId) && !emailDb.logs.some((l) => l.mailboxId === mailboxId)) {
    throw new Error("Mailbox not found.");
  }
  const page = Math.max(1, q.page ?? 1);
  const pageSize = q.pageSize ?? 25;
  const event = (q.event ?? "").toLowerCase();
  const rows = emailDb.logs
    .filter((l) => l.mailboxId === mailboxId)
    .filter((l) => !q.type || l.type === q.type)
    .filter((l) => !event || l.event.toLowerCase().includes(event));
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  return {
    data: clone(rows.slice((page - 1) * pageSize, page * pageSize)),
    pagination: { page, pageSize, totalPages, totalItems: rows.length },
  };
};

// ─── Password authentication ───────────────────────────────────────────────

/** Mock rule: an app password is 16 letters (spaces ignored, as Google shows it); "smtp" in it fails SMTP. */
const testConnection = async (data: TestConnectionRequest): Promise<TestConnectionResponse> => {
  await delay(1200);
  const pass = data.password.replace(/\s+/g, "");
  if (!data.imapHost || !data.smtpHost) throw new MailboxConnectionError("IMAP and SMTP hosts are required for this provider.");
  if (pass.toLowerCase().includes("smtp")) {
    throw new MailboxConnectionError(`Could not send through ${data.smtpHost}:${data.smtpPort ?? 465} — connection refused.`, "smtp");
  }
  if (pass.length < 16) {
    throw new MailboxConnectionError("Invalid credentials (AUTHENTICATIONFAILED). Use a 16-character app password, not your login password.", "imap");
  }
  return { success: true, message: "IMAP and SMTP connections succeeded." };
};

const addPasswordMailbox = async (data: AddPasswordMailboxRequest): Promise<AddPasswordMailboxResponse> => {
  await delay(800);
  const email = data.email.trim().toLowerCase();
  if (emailDb.mailboxes.some((m) => m.email.toLowerCase() === email)) throw new Error("This mailbox is already connected.");
  const provider = (Object.keys(PROVIDER_CONFIGS) as MailboxProvider[]).includes(data.provider as MailboxProvider)
    ? (data.provider as MailboxProvider)
    : "other";
  const now = new Date().toISOString();
  const mailbox: Mailbox = {
    _id: newId(),
    userId: USER_ID,
    email,
    displayName: data.displayName || email,
    authType: "password",
    provider,
    type: "personal",
    status: "connected",
    config: { imapHost: data.imapHost ?? "", imapPort: data.imapPort, smtpHost: data.smtpHost ?? "", smtpPort: data.smtpPort },
    createdAt: now,
    updatedAt: now,
  };
  emailDb.mailboxes = [...emailDb.mailboxes, mailbox];
  addLog(mailbox._id, "activity", "mailbox.connected", "Mailbox connected with an app password.", { provider });
  return { success: true, mailbox: clone(mailbox), message: "Mailbox added" };
};

const updateMailboxPassword = async (mailboxId: string, data: UpdatePasswordRequest): Promise<UpdatePasswordResponse> => {
  await delay(700);
  const mb = findMailbox(mailboxId);
  if (mb.authType === "oauth") throw new Error('This mailbox uses OAuth authentication. Use "Reconnect" instead.');
  if (data.password.replace(/\s+/g, "").length < 16) throw new Error("Invalid credentials (AUTHENTICATIONFAILED). Check the app password.");
  patchMailbox(mailboxId, { status: "connected" });
  addLog(mailboxId, "activity", "auth.password_updated", "App password updated.");
  return { success: true, message: "Password updated successfully" };
};

const getProviderConfig = async (provider: string): Promise<ProviderConfigResponse> => {
  await delay(200);
  const config = PROVIDER_CONFIGS[provider as MailboxProvider] ?? PROVIDER_CONFIGS.other;
  return { success: true, config: { ...config } };
};

// ─── OAuth (Zoho / Outlook) ────────────────────────────────────────────────

const getZohoSettings = async (): Promise<ZohoSettings> => {
  await delay(300);
  return { ...emailDb.zoho };
};

function upsertOAuthMailbox(provider: MailboxProvider, email: string, displayName: string, hosts: ProviderConfig): void {
  const now = new Date().toISOString();
  const existing = emailDb.mailboxes.find((m) => m.email === email);
  if (existing) {
    patchMailbox(existing._id, { status: "connected", authType: "oauth" });
    addLog(existing._id, "activity", "auth.reconnected", "Mailbox re-authorized.", { provider });
    return;
  }
  const mailbox: Mailbox = {
    _id: newId(),
    userId: USER_ID,
    email,
    displayName,
    authType: "oauth",
    provider,
    type: "enterprise",
    status: "connected",
    config: { ...hosts },
    createdAt: now,
    updatedAt: now,
  };
  emailDb.mailboxes = [...emailDb.mailboxes, mailbox];
  addLog(mailbox._id, "activity", "mailbox.connected", "Mailbox connected with OAuth.", { provider });
}

/**
 * Stores the company's Zoho app settings and returns the Zoho consent URL. Mock: the consent and
 * callback round trip is simulated here (the Zoho mailbox is connected / refreshed right away).
 */
const startZohoConnect = async (payload: ZohoConnectPayload): Promise<{ url?: string }> => {
  await delay(900);
  if (!payload.clientId.startsWith("1000.")) throw new Error("Zoho rejected the Client ID (invalid_client). Copy it again from the API console.");
  if (!payload.clientSecret && !emailDb.zoho.hasClientSecret) throw new Error("Client Secret is required.");
  emailDb.zoho = {
    ...emailDb.zoho,
    configured: true,
    clientId: payload.clientId,
    location: payload.location,
    redirectUri: payload.redirectUri,
    hasClientSecret: emailDb.zoho.hasClientSecret || Boolean(payload.clientSecret),
  };
  upsertOAuthMailbox("zoho", "ajio.claims@urbanthreads.in", "AJIO Claims Desk", {
    imapHost: `imap.zoho.${payload.location}`,
    imapPort: 993,
    smtpHost: `smtp.zoho.${payload.location}`,
    smtpPort: 465,
  });
  const url = new URL(`https://accounts.zoho.${payload.location}/oauth/v2/auth`);
  url.searchParams.set("client_id", payload.clientId);
  url.searchParams.set("redirect_uri", payload.redirectUri);
  url.searchParams.set("scope", "ZohoMail.messages.ALL,ZohoMail.accounts.READ");
  url.searchParams.set("access_type", "offline");
  return { url: url.toString() };
};

/**
 * TrackVid resolves `GET /api/mailboxes/:provider/auth` with axios inside IntegrationsSettings and opens
 * the provider page. Mock: the authorization is simulated and a provider URL is returned.
 */
const startOAuthConnect = async (provider: "outlook" | "google", mailboxId?: string): Promise<{ url: string }> => {
  await delay(900);
  if (mailboxId) {
    const mb = findMailbox(mailboxId);
    upsertOAuthMailbox(mb.provider, mb.email, mb.displayName ?? mb.email, {
      imapHost: mb.config.imapHost,
      imapPort: mb.config.imapPort ?? 993,
      smtpHost: mb.config.smtpHost,
      smtpPort: mb.config.smtpPort ?? 465,
    });
  } else if (provider === "outlook") {
    upsertOAuthMailbox("outlook", "support@urbanthreads.in", "Support (Outlook)", PROVIDER_CONFIGS.outlook);
  } else {
    upsertOAuthMailbox("google", "orders@urbanthreads.in", "Orders (Gmail)", PROVIDER_CONFIGS.google);
  }
  return {
    url: provider === "outlook" ? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize" : "https://accounts.google.com/o/oauth2/v2/auth",
  };
};

// ─── Manual single-mailbox polling ─────────────────────────────────────────

const syncMailbox = async (mailboxId: string): Promise<DataEnvelope<ManualSyncResult>> => {
  await delay(2400);
  const mb = findMailbox(mailboxId);
  if (mb.status !== "connected") throw new Error("Mailbox is not connected. Reconnect it before syncing.");
  const since = mb.inboxSync?.lastSyncedAt ?? mb.createdAt;
  const sinceMs = Math.max(new Date(since).getTime(), new Date(mb.createdAt).getTime());
  const sinceHours = (Date.now() - sinceMs) / 3_600_000;
  // Older watermark → more mail scanned; roughly one new AJIO claim per scan of 6 hours.
  const scanned = Math.min(40, Math.round(sinceHours * 1.5));
  const fetchedCount = Math.min(3, Math.floor(sinceHours / 6));
  const now = new Date().toISOString();
  for (let i = 0; i < fetchedCount; i += 1) {
    const orderNo = `FN72838${String(Math.floor(Math.random() * 90000) + 10000)}`;
    const incident = `INC52${String(Math.floor(Math.random() * 90000) + 10000)}`;
    const body = buildClaimBody(orderNo, incident, "UT-KURTA-NVY-L", "Wrong colour received");
    emailDb.emails = [
      {
        _id: newId(),
        subject: `Return claim raised | Customer Order No ${orderNo} | ${incident}`,
        sender: AJIO_SENDER,
        status: "new",
        receivedAt: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
        matchingPattern: "ajio_return_claim",
        snippet: `Dear Seller, the customer has raised a return claim. Incident ID: ${incident}.`,
        body,
        bodyRaw: body,
        retryAttempts: 0,
        mailboxId,
        replyDetail: null,
        meta: { header: { date: now }, customerOrderNo: orderNo, incidentId: incident },
      },
      ...emailDb.emails,
    ];
  }
  const skippedTotal = Math.max(0, scanned - fetchedCount);
  const skipped: Record<string, number> = skippedTotal
    ? { not_ajio: Math.ceil(skippedTotal * 0.7), already_processed: Math.floor(skippedTotal * 0.3) }
    : {};
  patchMailbox(mailboxId, { inboxSync: { lastSyncedAt: now }, lastSyncedAt: now });
  addLog(mailboxId, "activity", "sync.completed", "Manual sync completed.", { scanned, fetched: fetchedCount, skipped, trigger: "manual" });
  return {
    data: {
      mailboxId,
      provider: mb.provider,
      email: mb.email,
      fetchedCount,
      unrepliedCount: fetchedCount,
      lastSyncedAt: now,
      scanned,
      skipped,
      effectiveSince: new Date(sinceMs).toISOString(),
      statusWritesAllowed: true,
    },
    displayMessage: "Mailbox synced.",
  };
};

/** `lastSyncedAt: null` clears the watermark (next sync falls back to mailbox creation time). */
const updateMailboxLastSync = async (mailboxId: string, lastSyncedAt: string | null): Promise<{ message: string }> => {
  await delay(500);
  const mb = findMailbox(mailboxId);
  if (lastSyncedAt) {
    const t = new Date(lastSyncedAt).getTime();
    if (Number.isNaN(t)) throw new Error("Enter a valid date and time.");
    if (t > Date.now()) throw new Error("Last sync date cannot be in the future.");
    if (t < new Date(mb.createdAt).getTime()) throw new Error("The date cannot be earlier than when the mailbox was connected.");
    patchMailbox(mailboxId, { inboxSync: { lastSyncedAt }, lastSyncedAt });
  } else {
    patchMailbox(mailboxId, { inboxSync: undefined, lastSyncedAt: undefined });
  }
  addLog(mailboxId, "activity", "sync.watermark_changed", lastSyncedAt ? "Last sync date changed." : "Last sync date cleared.", { lastSyncedAt });
  return { message: lastSyncedAt ? "Last sync date updated." : "Last sync date cleared." };
};

// ─── Fetch folder (company level) ──────────────────────────────────────────

const getMailFetchFolder = async (): Promise<DataEnvelope<MailFetchFolderResponse>> => {
  await delay(250);
  return { data: { mailFetchFolder: emailDb.mailFetchFolder, options: [...FETCH_FOLDER_OPTIONS] } };
};

const updateMailFetchFolder = async (mailFetchFolder: MailFetchFolder): Promise<DataEnvelope<MailFetchFolderResponse>> => {
  await delay(500);
  if (!FETCH_FOLDER_OPTIONS.includes(mailFetchFolder)) throw new Error("Unsupported folder.");
  emailDb.mailFetchFolder = mailFetchFolder;
  return { data: { mailFetchFolder, options: [...FETCH_FOLDER_OPTIONS] }, displayMessage: "Fetch folder updated." };
};

export const MailboxService = {
  syncMailbox,
  getMailFetchFolder,
  updateMailFetchFolder,
  updateMailboxLastSync,
  getZohoSettings,
  startZohoConnect,
  startOAuthConnect,
  checkMailboxStatus,
  listMailboxes,
  removeMailbox,
  getMailboxLogs,
  testConnection,
  addPasswordMailbox,
  updateMailboxPassword,
  getProviderConfig,
};
