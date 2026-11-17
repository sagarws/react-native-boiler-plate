import { daysAgo, seeded } from "@/mocks/delay";
import type { EmailRow, EmailStatus, Mailbox, MailboxLogEntry, ZohoSettings } from "@/types/emails";

/** Sample data for the AJIO email automation screens (emails, mailboxes, mailbox logs). */

const USER_ID = "64f0c0ffee0000000000a001";

export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export const sampleMailboxes: Mailbox[] = [
  {
    _id: "6650mb000000000000000001",
    userId: USER_ID,
    email: "returns@urbanthreads.in",
    displayName: "Urban Threads Returns",
    authType: "password",
    provider: "google",
    type: "personal",
    status: "connected",
    config: { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465 },
    inboxSync: { lastSyncedAt: minutesAgo(6) },
    lastSyncedAt: minutesAgo(6),
    createdAt: daysAgo(140),
    updatedAt: minutesAgo(6),
  },
  {
    _id: "6650mb000000000000000002",
    userId: USER_ID,
    email: "ajio.claims@urbanthreads.in",
    displayName: "AJIO Claims Desk",
    authType: "oauth",
    provider: "zoho",
    type: "enterprise",
    status: "connected",
    config: { imapHost: "imap.zoho.in", imapPort: 993, smtpHost: "smtp.zoho.in", smtpPort: 465 },
    inboxSync: { lastSyncedAt: minutesAgo(60 * 13) },
    lastSyncedAt: minutesAgo(60 * 13),
    createdAt: daysAgo(75),
    updatedAt: minutesAgo(60 * 13),
  },
  {
    _id: "6650mb000000000000000003",
    userId: USER_ID,
    email: "support@urbanthreads.in",
    displayName: "Support (Outlook)",
    authType: "oauth",
    provider: "outlook",
    type: "enterprise",
    status: "token_expired",
    config: { imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp.office365.com", smtpPort: 587 },
    inboxSync: { lastSyncedAt: daysAgo(3) },
    lastSyncedAt: daysAgo(3),
    createdAt: daysAgo(40),
    updatedAt: daysAgo(3),
  },
];

export const sampleZohoSettings: ZohoSettings = {
  configured: true,
  clientId: "1000.7QK2D9TRV8B4LZ1XW0N6C3PJ5HMA2E",
  location: "in",
  redirectUri: "https://app.trackvid.in/oauth/zoho/callback",
  suggestedRedirectUri: "https://app.trackvid.in/oauth/zoho/callback",
  hasClientSecret: true,
};

/** Orders the AWB manual fix can find (AWB → order no / packing video). */
export interface SampleOrder {
  awb: string;
  orderNo: string | null;
  hasVideo: boolean;
  createdAt: string;
}

export const sampleOrders: SampleOrder[] = [
  { awb: "FN7123804342", orderNo: null, hasVideo: true, createdAt: daysAgo(6) },
  { awb: "FN7123804388", orderNo: "FN7283804111", hasVideo: true, createdAt: daysAgo(8) },
  { awb: "1490325567781", orderNo: null, hasVideo: false, createdAt: daysAgo(5) },
  { awb: "DL55821039IN", orderNo: null, hasVideo: true, createdAt: daysAgo(9) },
  { awb: "XB9928114650", orderNo: "FN7283809999", hasVideo: true, createdAt: daysAgo(12) },
];

export const SAMPLE_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const AJIO_SENDER = { name: "AJIO Seller Support", email: "sellersupport@ajio.com" };

const claimBody = (orderNo: string | null, incident: string, sku: string, reason: string): string =>
  [
    "<p>Dear Seller,</p>",
    `<p>The customer has raised a return claim${orderNo ? ` for <b>Customer Order No ${orderNo}</b>` : ""}. Incident ID: <b>${incident}</b>.</p>`,
    "<table border=\"1\" cellpadding=\"6\" style=\"border-collapse:collapse\">",
    `<tr><td>SKU</td><td>${sku}</td></tr>`,
    `<tr><td>Reason</td><td>${reason}</td></tr>`,
    "<tr><td>Claim type</td><td>Wrong / damaged product received</td></tr>",
    "</table>",
    "<p>Please share the packing video of this shipment within <b>48 hours</b> to avoid an auto-approved refund.</p>",
    "<p>Regards,<br/>AJIO Seller Support</p>",
    // Untrusted markup on purpose: the screen must strip scripts and event handlers.
    "<script>window.__pwned = true;</script><img src=\"x\" onerror=\"window.__pwned=true\" alt=\"\" />",
  ].join("");

const replyBody = (orderNo: string, awb: string): string =>
  [
    "<p>Dear AJIO Team,</p>",
    `<p>Please find the packing video for <b>Customer Order No ${orderNo}</b> (AWB ${awb}).</p>`,
    `<p><a href="https://drive.google.com/file/d/1aB2c3D4e5F6g7H8i9J0/view">Packing video (Google Drive)</a></p>`,
    "<p>The product was packed in good condition and the seal was intact at dispatch.</p>",
    "<p>Regards,<br/>Urban Threads</p>",
  ].join("");

const SKUS = ["UT-TSHIRT-BLK-M", "UT-KURTA-NVY-L", "UT-JEANS-IND-32", "UT-DRESS-MRN-S", "UT-SHIRT-WHT-XL", "UT-JOGGER-GRY-M"];
const REASONS = ["Product damaged", "Wrong colour received", "Used product received", "Size label missing", "Empty package", "Different product received"];

interface Seed {
  status: EmailStatus;
  minutes: number;
  mailbox: number;
  orderInEmail?: boolean;
  errorCode?: string;
  errorMessage?: string;
  retryAttempts?: number;
  ack?: boolean;
}

const seeds: Seed[] = [
  // Pending — new / fetched
  { status: "new", minutes: 4, mailbox: 0 },
  { status: "new", minutes: 22, mailbox: 1 },
  { status: "new", minutes: 95, mailbox: 0 },
  { status: "new", minutes: 60 * 26, mailbox: 2 },
  { status: "fetched", minutes: 38, mailbox: 1 },
  { status: "fetched", minutes: 140, mailbox: 0 },
  { status: "fetched", minutes: 60 * 20, mailbox: 1 },
  { status: "fetched", minutes: 60 * 50, mailbox: 0 },
  { status: "fetched", minutes: 60 * 72, mailbox: 2 },
  // Pending — failed
  { status: "error", minutes: 55, mailbox: 0, errorCode: "order_not_found", errorMessage: "Unable to locate order for this customer order no.", retryAttempts: 1 },
  { status: "error", minutes: 180, mailbox: 1, errorCode: "video_not_found", errorMessage: "Video is not found for the linked AWB.", retryAttempts: 2 },
  { status: "error", minutes: 60 * 7, mailbox: 1, orderInEmail: false, errorCode: "order_identifier_missing", errorMessage: "Unable to determine order identifier from the email.", retryAttempts: 1 },
  { status: "error", minutes: 60 * 30, mailbox: 0, errorCode: "smtp_failed", errorMessage: "SMTP connection timed out while sending the reply.", retryAttempts: 3 },
  { status: "error", minutes: 60 * 44, mailbox: 0, errorMessage: "Unable to locate order for customer order no.", retryAttempts: 2 },
  { status: "error", minutes: 60 * 60, mailbox: 1, errorCode: "order_not_found", errorMessage: "Unable to locate order for this customer order no.", retryAttempts: 5 },
  { status: "error", minutes: 60 * 96, mailbox: 2, errorCode: "mailbox_disconnected", errorMessage: "Mailbox token expired. Reconnect the mailbox and retry.", retryAttempts: 5 },
  { status: "error", minutes: 60 * 120, mailbox: 0, errorCode: "video_not_found", errorMessage: "Video is not found for the linked AWB.", retryAttempts: 1 },
  // Replied — today
  { status: "replied", minutes: 12, mailbox: 0, ack: true },
  { status: "replied", minutes: 47, mailbox: 1 },
  { status: "replied", minutes: 85, mailbox: 1, ack: true },
  { status: "replied", minutes: 130, mailbox: 0 },
  { status: "manually_replied", minutes: 160, mailbox: 0 },
  { status: "replied", minutes: 200, mailbox: 1, ack: true },
  // Replied — earlier
  ...Array.from({ length: 16 }, (_, i): Seed => ({
    status: i % 5 === 3 ? "manually_replied" : "replied",
    minutes: 60 * 24 * (1 + i) + 37 * i,
    mailbox: i % 3 === 2 ? 1 : 0,
    ack: i % 2 === 0,
  })),
];

function buildEmails(): EmailRow[] {
  const rand = seeded(4242);
  return seeds.map((s, i) => {
    const n = String(7283804270 + i * 137);
    const orderNo = s.orderInEmail === false ? null : `FN${n}`;
    const incident = `INC${String(5100000 + i * 911)}`;
    const sku = SKUS[i % SKUS.length];
    const reason = REASONS[Math.floor(rand() * REASONS.length)];
    const receivedAt = minutesAgo(s.minutes + 3);
    const mailbox = sampleMailboxes[s.mailbox];
    const body = claimBody(orderNo, incident, sku, reason);
    const isReplied = s.status === "replied" || s.status === "manually_replied";
    const repliedAt = isReplied ? minutesAgo(s.minutes) : undefined;
    const awb = `FN7123${String(800000 + i * 53)}`;
    return {
      _id: `6650em${String(i + 1).padStart(18, "0")}`,
      subject: orderNo
        ? `Return claim raised | Customer Order No ${orderNo} | ${incident}`
        : `Return claim raised | ${incident} | Action required`,
      sender: AJIO_SENDER,
      status: s.status,
      receivedAt,
      matchingPattern: "ajio_return_claim",
      snippet: `Dear Seller, the customer has raised a return claim. Incident ID: ${incident}. Reason: ${reason}.`,
      body,
      bodyRaw: body,
      retryAttempts: s.retryAttempts ?? 0,
      mailboxId: mailbox._id,
      replyDetail:
        s.status === "error"
          ? { errorCode: s.errorCode, errorMessage: s.errorMessage }
          : isReplied
            ? s.status === "manually_replied"
              ? { repliedAt }
              : {
                  subject: `Re: Return claim raised | Customer Order No ${orderNo ?? ""} | ${incident}`,
                  body: replyBody(orderNo ?? "—", awb),
                  bodyRaw: replyBody(orderNo ?? "—", awb),
                  repliedAt,
                  to: AJIO_SENDER.email,
                  cc: "claims-escalation@ajio.com",
                }
            : null,
      meta: {
        header: { date: receivedAt, messageId: `<${incident}.${i}@mail.ajio.com>` },
        customerOrderNo: orderNo,
        incidentId: incident,
        sku,
      },
      ajioAcknowledgementReplied: s.ack === true,
      ajioAcknowledgementAt: s.ack ? minutesAgo(Math.max(1, s.minutes - 5)) : undefined,
    };
  });
}

export const sampleEmails: EmailRow[] = buildEmails();

const LOG_TEMPLATES: Array<{ type: "activity" | "error"; event: string; message: string; meta: (i: number) => Record<string, unknown> }> = [
  { type: "activity", event: "sync.started", message: "Inbox sync started.", meta: (i) => ({ folder: i % 4 === 0 ? "allMail" : "inbox", trigger: i % 5 === 0 ? "manual" : "scheduler" }) },
  {
    type: "activity",
    event: "sync.completed",
    message: "Inbox sync completed.",
    meta: (i) => ({ scanned: 8 + (i % 9), fetched: i % 4, skipped: { not_ajio: 3 + (i % 5), already_processed: i % 3 }, durationMs: 1800 + i * 37 }),
  },
  { type: "activity", event: "email.fetched", message: "AJIO claim email fetched.", meta: (i) => ({ subject: `Return claim raised | INC${5100000 + i * 13}`, pattern: "ajio_return_claim" }) },
  { type: "activity", event: "reply.sent", message: "Auto reply sent to AJIO.", meta: (i) => ({ to: "sellersupport@ajio.com", customerOrderNo: `FN${7283804270 + i}`, attempt: 1 }) },
  { type: "error", event: "reply.failed", message: "Reply failed: Unable to locate order for customer order no.", meta: (i) => ({ code: "order_not_found", customerOrderNo: `FN${7283804270 + i}`, attempt: 1 + (i % 3) }) },
  { type: "activity", event: "auth.token_refreshed", message: "Access token refreshed.", meta: () => ({ expiresIn: 3600 }) },
  { type: "error", event: "imap.connection_error", message: "IMAP connection dropped. Will retry on the next cycle.", meta: (i) => ({ host: "imap.gmail.com", port: 993, error: "ETIMEDOUT", retryInSec: 60 + i }) },
  { type: "activity", event: "ajio.acknowledged", message: "AJIO acknowledged the reply.", meta: (i) => ({ incidentId: `INC${5100000 + i * 13}` }) },
];

function buildLogs(): MailboxLogEntry[] {
  const logs: MailboxLogEntry[] = [];
  sampleMailboxes.forEach((mb, m) => {
    const rand = seeded(900 + m);
    const count = m === 2 ? 34 : 78;
    for (let i = 0; i < count; i += 1) {
      const tpl = LOG_TEMPLATES[Math.floor(rand() * LOG_TEMPLATES.length)];
      const createdAt = minutesAgo(i * 47 + m * 3 + 1);
      logs.push({
        id: `6650lg${m}${String(i).padStart(17, "0")}`,
        mailboxId: mb._id,
        type: tpl.type,
        event: tpl.event,
        message: tpl.message,
        createdAt,
        metadata: i % 9 === 8 ? {} : { mailbox: mb.email, ...tpl.meta(i) },
      });
    }
    if (mb.status === "token_expired") {
      logs.unshift({
        id: `6650lg${m}x0000000000000001`,
        mailboxId: mb._id,
        type: "error",
        event: "auth.token_expired",
        message: "Refresh token was revoked by the provider. Reconnect the mailbox.",
        createdAt: daysAgo(3),
        metadata: { provider: mb.provider, error: "invalid_grant" },
      });
    }
  });
  return logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const sampleMailboxLogs: MailboxLogEntry[] = buildLogs();

/** Subjects used when the live-update simulation drops a new AJIO email into the inbox. */
export const incomingSubjects = [
  "Return claim raised | Customer Order No FN7283811042 | INC5199001",
  "Return claim raised | Customer Order No FN7283811175 | INC5199114",
  "Return claim raised | Customer Order No FN7283811230 | INC5199270",
];
export { claimBody as buildClaimBody, replyBody as buildReplyBody, AJIO_SENDER };

/**
 * In-memory "database" shared by `email-automation-service` and `mailbox-service` (both mutate it,
 * so a manual sync can drop emails into the inbox and the inbox can read mailbox status).
 */
export const emailDb: {
  emails: EmailRow[];
  mailboxes: Mailbox[];
  logs: MailboxLogEntry[];
  zoho: ZohoSettings;
  mailFetchFolder: "inbox" | "allMail";
} = {
  emails: structuredClone(sampleEmails),
  mailboxes: structuredClone(sampleMailboxes),
  logs: structuredClone(sampleMailboxLogs),
  zoho: { ...sampleZohoSettings },
  mailFetchFolder: "inbox",
};
