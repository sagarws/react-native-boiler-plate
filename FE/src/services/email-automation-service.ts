import { toCsv } from "@/lib/download";
import { clone, delay, newId } from "@/mocks/delay";
import { AJIO_SENDER, buildClaimBody, buildReplyBody, emailDb, incomingSubjects, sampleOrders, SAMPLE_VIDEO_URL } from "@/mocks/emails";
import type {
  AwbPreview,
  EmailActionResponse,
  EmailCountParams,
  EmailCountResponse,
  EmailDetailsResponse,
  EmailExportParams,
  EmailListByStatusParams,
  EmailListParams,
  EmailManualFix,
  EmailOverview,
  EmailRetryBulkResponse,
  EmailRow,
  EmailSection,
  EmailStatusFilter,
  EmailTodayStats,
  ManualFixContext,
  ManualFixErrorBody,
  ManualFixIssue,
  ManualFixResponse,
  ManualFixSendResult,
} from "@/types/emails";

/**
 * Mock of TrackVid-FE `api/email-automation-service.ts` (`/emails/*`). Same function names; each
 * resolves with the response body. Data lives in `emailDb` (shared with `mailbox-service`).
 * Dashboard reads `getTodayStats`, the shell badge reads `getPendingEmailCount`.
 */

const PENDING_STATUSES = new Set(["new", "fetched", "error"]);
const REPLIED_STATUSES = new Set(["replied", "manually_replied"]);

const sectionOf = (status: EmailStatusFilter) => (status === "pending" ? PENDING_STATUSES : REPLIED_STATUSES);

/** Replied rows are filtered by their reply time, pending rows by when they arrived (TrackVid BE rule). */
const filterDate = (row: EmailRow, status: EmailStatusFilter): number =>
  new Date(status === "replied" ? (row.replyDetail?.repliedAt ?? row.receivedAt) : row.receivedAt).getTime();

function inRange(value: number, start?: string, end?: string): boolean {
  if (start && value < new Date(start).getTime()) return false;
  if (end && value > new Date(end).getTime()) return false;
  return true;
}

function query(status: EmailStatusFilter, mailboxId?: string, startDate?: string, endDate?: string): EmailRow[] {
  const set = sectionOf(status);
  return emailDb.emails
    .filter((e) => set.has(e.status))
    .filter((e) => !mailboxId || mailboxId === "all" || e.mailboxId === mailboxId)
    .filter((e) => inRange(filterDate(e, status), startDate, endDate))
    .sort((a, b) => filterDate(b, status) - filterDate(a, status));
}

/** List rows ship without the heavy fields (body / meta), like the real list endpoint. */
const toListRow = (e: EmailRow): EmailRow => {
  const { body: _body, bodyRaw: _bodyRaw, meta: _meta, ...rest } = e;
  void _body;
  void _bodyRaw;
  void _meta;
  return {
    ...rest,
    replyDetail: e.replyDetail ? { ...e.replyDetail, body: undefined, bodyRaw: undefined } : e.replyDetail,
  };
};

function section(rows: EmailRow[], page: number, pageSize: number): EmailSection {
  const start = Math.max(0, (page - 1) * pageSize);
  const items = rows.slice(start, start + pageSize).map(toListRow);
  return { items: clone(items), total: rows.length, page, pageSize, hasMore: start + pageSize < rows.length };
}

function findEmail(emailId: string): EmailRow {
  const email = emailDb.emails.find((e) => e._id === emailId);
  if (!email) throw new Error("Email not found.");
  return email;
}

function updateEmail(emailId: string, patch: Partial<EmailRow>): EmailRow {
  emailDb.emails = emailDb.emails.map((e) => (e._id === emailId ? { ...e, ...patch } : e));
  return findEmail(emailId);
}

const customerOrderNoOf = (email: EmailRow): string | null => {
  const v = email.meta?.customerOrderNo;
  return typeof v === "string" && v ? v : null;
};

const mailboxOf = (email: EmailRow) => emailDb.mailboxes.find((m) => m._id === email.mailboxId);

/** Sends the AJIO reply for one email (mock): needs a connected mailbox and, for fixable failures, a fix. */
function sendReply(email: EmailRow): { ok: true; row: EmailRow } | { ok: false; code: string; message: string } {
  const mailbox = mailboxOf(email);
  if (!mailbox) return { ok: false, code: "mailbox_not_found", message: "The mailbox for this email was removed." };
  if (mailbox.status !== "connected") {
    return { ok: false, code: "mailbox_disconnected", message: "Mailbox is disconnected. Reconnect it and retry." };
  }
  const code = email.replyDetail?.errorCode;
  const stillBroken = email.status === "error" && !email.manualFix && (code === "order_not_found" || code === "video_not_found" || code === "order_identifier_missing");
  if (stillBroken) return { ok: false, code: code ?? "reply_failed", message: email.replyDetail?.errorMessage ?? "Reply failed." };

  const orderNo = email.manualFix?.customerOrderNo ?? customerOrderNoOf(email) ?? "—";
  const awb = email.manualFix?.awb ?? "FN7123804342";
  const body = buildReplyBody(orderNo, awb);
  const row = updateEmail(email._id, {
    status: "replied",
    replyDetail: {
      subject: `Re: ${email.subject}`,
      body,
      bodyRaw: body,
      repliedAt: new Date().toISOString(),
      to: AJIO_SENDER.email,
      cc: "claims-escalation@ajio.com",
    },
  });
  return { ok: true, row };
}

function failSend(email: EmailRow, code: string, message: string): EmailRow {
  return updateEmail(email._id, {
    status: "error",
    retryAttempts: (email.retryAttempts ?? 0) + 1,
    replyDetail: { ...(email.replyDetail ?? {}), errorCode: code, errorMessage: message },
  });
}

// ─── List / counts ─────────────────────────────────────────────────────────

const listEmails = async (params: EmailListParams): Promise<EmailOverview> => {
  await delay();
  return {
    pending: section(query("pending", params.mailboxId, params.startDate, params.endDate), params.pendingPage, params.pageSize),
    replied: section(query("replied", params.mailboxId, params.startDate, params.endDate), params.repliedPage, params.pageSize),
  };
};

/** Asks the server to poll every mailbox now, then returns the overview (mock: same as list). */
const fetchEmails = async (params: EmailListParams): Promise<EmailOverview> => {
  await delay(900);
  return listEmails(params);
};

const getEmailCounts = async (params: EmailCountParams): Promise<EmailCountResponse> => {
  await delay(200);
  return {
    pending: { total: query("pending", params.mailboxId, params.pendingStartDate, params.pendingEndDate).length },
    replied: { total: query("replied", params.mailboxId, params.repliedStartDate, params.repliedEndDate).length },
  };
};

const listEmailsByStatus = async (params: EmailListByStatusParams): Promise<EmailSection> => {
  await delay();
  return section(query(params.status, params.mailboxId, params.startDate, params.endDate), params.page, params.pageSize);
};

/** Mock export: TrackVid downloads an .xlsx; without a spreadsheet library the mock returns CSV. */
const exportEmails = async (params: EmailExportParams): Promise<Blob> => {
  await delay(600);
  let rows = query(params.status, params.mailboxId, params.startDate, params.endDate);
  if (params.scope === "page" && params.page && params.pageSize) {
    rows = rows.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);
  }
  const header = ["Subject", "Sender", "Sender Email", "Mailbox", "Status", "Received At", "Replied At", "Error", "Ajio Acknowledged"];
  const lines = rows.map((e) => [
    e.subject,
    e.sender.name ?? "",
    e.sender.email,
    mailboxOf(e)?.email ?? "",
    e.status,
    e.receivedAt,
    e.replyDetail?.repliedAt ?? "",
    e.status === "error" ? (e.replyDetail?.errorMessage ?? "") : "",
    e.ajioAcknowledgementReplied ? "Yes" : "No",
  ]);
  return new Blob([toCsv([header, ...lines])], { type: "text/csv;charset=utf-8" });
};

const getEmailDetails = async (emailId: string): Promise<EmailDetailsResponse> => {
  await delay(300);
  const e = findEmail(emailId);
  return clone({
    _id: e._id,
    body: e.body,
    bodyRaw: e.bodyRaw,
    meta: e.meta,
    replyDetail: e.replyDetail
      ? { body: e.replyDetail.body, bodyRaw: e.replyDetail.bodyRaw, repliedAt: e.replyDetail.repliedAt, errorMessage: e.replyDetail.errorMessage }
      : null,
  });
};

// ─── Actions ───────────────────────────────────────────────────────────────

const retryBulkEmails = async (emailIds: string[]): Promise<EmailRetryBulkResponse> => {
  await delay(800);
  const result: EmailRetryBulkResponse = { enqueued: 0, skipped: 0, breakdown: {}, details: [], enqueuedIds: [] };
  for (const id of emailIds) {
    const email = emailDb.emails.find((e) => e._id === id);
    let reason: string | null = null;
    if (!email) reason = "not_found";
    else if (email.status !== "error") reason = "not_failed";
    else {
      const mb = mailboxOf(email);
      const code = email.replyDetail?.errorCode;
      if (!mb || mb.status !== "connected") reason = "mailbox_disconnected";
      else if (!email.manualFix && (code === "order_not_found" || code === "order_identifier_missing")) reason = "order_missing";
      else if (!email.manualFix && code === "video_not_found") reason = "video_missing";
    }
    if (reason || !email) {
      result.skipped += 1;
      const r = reason ?? "not_found";
      result.breakdown[r] = (result.breakdown[r] ?? 0) + 1;
      result.details.push({ emailId: id, reason: r, currentStatus: email?.status });
    } else {
      updateEmail(id, { status: "fetched" });
      result.enqueued += 1;
      result.enqueuedIds?.push(id);
    }
  }
  return result;
};

const replyToEmail = async (emailId: string): Promise<EmailActionResponse> => {
  await delay(900);
  const email = findEmail(emailId);
  const sent = sendReply(email);
  if (!sent.ok) {
    failSend(email, sent.code, sent.message);
    throw new Error(sent.message);
  }
  return { message: "Reply sent", email: clone(sent.row) };
};

/** Sends the reply again for an already replied email. */
const forceReplyToEmail = async (emailId: string): Promise<EmailActionResponse> => {
  await delay(900);
  const email = findEmail(emailId);
  const mailbox = mailboxOf(email);
  if (!mailbox || mailbox.status !== "connected") throw new Error("Mailbox is disconnected. Reconnect it and retry.");
  const row = updateEmail(emailId, {
    status: "replied",
    replyDetail: { ...(email.replyDetail ?? {}), repliedAt: new Date().toISOString(), errorCode: undefined, errorMessage: undefined },
  });
  return { message: "Reply sent", email: clone(row) };
};

const markManualReply = async (emailId: string): Promise<EmailActionResponse> => {
  await delay(500);
  const email = findEmail(emailId);
  const row = updateEmail(emailId, {
    status: "manually_replied",
    replyDetail: { ...(email.replyDetail ?? {}), repliedAt: new Date().toISOString() },
  });
  return { message: "Marked as manually replied", email: clone(row) };
};

const getTodayStats = async (params?: { from?: string; to?: string }): Promise<EmailTodayStats> => {
  await delay(250);
  const from = params?.from;
  const to = params?.to;
  const replied = emailDb.emails.filter((e) => e.status === "replied" && inRange(filterDate(e, "replied"), from, to)).length;
  const manual = emailDb.emails.filter((e) => e.status === "manually_replied" && inRange(filterDate(e, "replied"), from, to)).length;
  const failed = emailDb.emails.filter((e) => e.status === "error" && inRange(new Date(e.receivedAt).getTime(), from, to)).length;
  return { totalSent: replied + manual, replied, failed, manual };
};

const getPendingEmailCount = async (): Promise<{ count: number }> => {
  await delay(200);
  return { count: emailDb.emails.filter((e) => PENDING_STATUSES.has(e.status)).length };
};

// ─── Manual fix for failed AJIO replies ────────────────────────────────────

const fail = <T>(status: number, code: string, message: string, preview?: AwbPreview): ManualFixResponse<T> => {
  const body: ManualFixErrorBody = { error: message, displayMessage: message, code, preview };
  return { ok: false, status, body };
};

function fixableEmail(emailId: string): EmailRow | ManualFixResponse<never> {
  const email = emailDb.emails.find((e) => e._id === emailId);
  if (!email) return fail(404, "email_not_found", "Email not found.");
  if (email.status !== "error") return fail(409, "not_failed", "This email is no longer failed — refresh the list.");
  return email;
}

const isResponse = <T>(v: EmailRow | ManualFixResponse<T>): v is ManualFixResponse<T> => "ok" in v;

const getManualFixContext = async (emailId: string): Promise<ManualFixResponse<ManualFixContext>> => {
  await delay(300);
  const email = fixableEmail(emailId);
  if (isResponse(email)) return email;
  const orderNo = customerOrderNoOf(email);
  return {
    ok: true,
    data: { emailId, customerOrderNo: orderNo, customerOrderNoFromEmail: orderNo !== null, manualFix: email.manualFix ? clone(email.manualFix) : null },
  };
};

function evaluate(email: EmailRow, awb: string, customerOrderNo?: string): ManualFixResponse<AwbPreview> {
  const fromEmail = customerOrderNoOf(email);
  const orderNo = fromEmail ?? customerOrderNo?.trim() ?? null;
  if (!orderNo) return fail(400, "customer_order_no_required", "Enter the customer order no from the AJIO ticket.");
  const order = sampleOrders.find((o) => o.awb.toLowerCase() === awb.trim().toLowerCase()) ?? null;
  const blockers: ManualFixIssue[] = [];
  const warnings: ManualFixIssue[] = [];
  if (!order) blockers.push({ code: "order_not_found", message: `No order found for AWB ${awb.trim()}. Check the AWB on the packing record.` });
  else {
    if (!order.hasVideo) blockers.push({ code: "video_not_found", message: "No packing video is recorded for this AWB yet." });
    if (order.orderNo && order.orderNo !== orderNo) {
      warnings.push({ code: "awb_linked_elsewhere", message: `This AWB is already linked to order no ${order.orderNo}. Linking replaces it with ${orderNo}.` });
    }
  }
  const otherAwb = sampleOrders.find((o) => o.orderNo === orderNo && o.awb !== order?.awb);
  if (otherAwb) warnings.push({ code: "order_linked_elsewhere", message: `Order no ${orderNo} is already linked to AWB ${otherAwb.awb}.` });
  return {
    ok: true,
    data: {
      emailId: email._id,
      customerOrderNo: orderNo,
      customerOrderNoFromEmail: fromEmail !== null,
      awb: order?.awb ?? awb.trim(),
      order: order ? { trackingId: order.awb, orderNo: order.orderNo, createdAt: order.createdAt } : null,
      hasVideo: Boolean(order?.hasVideo),
      videoUrl: order?.hasVideo ? SAMPLE_VIDEO_URL : null,
      evaluation: { canLink: blockers.length === 0, blockers, warnings },
    },
  };
}

const previewAwbLink = async (emailId: string, awb: string, customerOrderNo?: string): Promise<ManualFixResponse<AwbPreview>> => {
  await delay(350);
  const email = fixableEmail(emailId);
  if (isResponse(email)) return email;
  return evaluate(email, awb, customerOrderNo);
};

function saveFixAndSend(email: EmailRow, fix: EmailManualFix, preview?: AwbPreview): ManualFixSendResult {
  const fixed = updateEmail(email._id, { manualFix: fix });
  const sent = sendReply(fixed);
  if (sent.ok) return { fixSaved: true, sent: true, status: "replied", manualFix: fix, preview };
  const row = failSend(fixed, sent.code, sent.message);
  return { fixSaved: true, sent: false, status: "error", error: { code: sent.code, message: sent.message }, manualFix: row.manualFix ?? fix, preview };
}

const linkAwbAndSend = async (
  emailId: string,
  body: { awb: string; customerOrderNo?: string; confirmReplace?: boolean },
): Promise<ManualFixResponse<ManualFixSendResult>> => {
  await delay(900);
  const email = fixableEmail(emailId);
  if (isResponse(email)) return email;
  const check = evaluate(email, body.awb, body.customerOrderNo);
  if (!check.ok) return check;
  const preview = check.data;
  if (!preview.evaluation.canLink) return fail(422, "cannot_link", preview.evaluation.blockers[0]?.message ?? "This AWB cannot be linked.", preview);
  if (preview.evaluation.warnings.length > 0 && !body.confirmReplace) {
    return fail(409, "confirm_replace", "The link changed since you checked it — review and confirm again.", preview);
  }
  sampleOrders.forEach((o) => {
    if (o.awb === preview.awb) o.orderNo = preview.customerOrderNo;
  });
  const fix: EmailManualFix = {
    type: "awb",
    awb: preview.awb,
    customerOrderNo: preview.customerOrderNo ?? undefined,
    previousOrderNo: preview.order?.orderNo ?? null,
    by: "aarav@urbanthreads.in",
    at: new Date().toISOString(),
  };
  return { ok: true, data: clone(saveFixAndSend(email, fix, preview)) };
};

const addVideoLinkAndSend = async (emailId: string, videoLink: string): Promise<ManualFixResponse<ManualFixSendResult>> => {
  await delay(900);
  const email = fixableEmail(emailId);
  if (isResponse(email)) return email;
  let valid = false;
  try {
    const url = new URL(videoLink.trim());
    valid = url.protocol === "https:" && url.hostname.toLowerCase() === "drive.google.com" && url.pathname.length > 1;
  } catch {
    // Not a URL at all; reported as invalid below.
    valid = false;
  }
  if (!valid) return fail(400, "invalid_video_link", "AJIO only accepts https://drive.google.com links.");
  const fix: EmailManualFix = {
    type: "video_link",
    videoLink: videoLink.trim(),
    customerOrderNo: customerOrderNoOf(email) ?? undefined,
    by: "aarav@urbanthreads.in",
    at: new Date().toISOString(),
  };
  return { ok: true, data: clone(saveFixAndSend(email, fix)) };
};

// ─── Live updates (replaces the socket.io `emails:*:update` events) ────────

/**
 * Simulates the server pushing inbox changes: every `intervalMs` a new AJIO email may arrive on a
 * connected mailbox, and the auto-reply worker answers one fetched email. Returns the unsubscribe.
 */
const subscribeEmailUpdates = (onUpdate: () => void, intervalMs = 45_000): (() => void) => {
  let tick = 0;
  const timer = window.setInterval(() => {
    tick += 1;
    const connected = emailDb.mailboxes.filter((m) => m.status === "connected");
    if (tick % 2 === 1 && connected.length) {
      const mb = connected[tick % connected.length];
      const subject = incomingSubjects[tick % incomingSubjects.length];
      const orderNo = /FN\d+/.exec(subject)?.[0] ?? null;
      const incident = /INC\d+/.exec(subject)?.[0] ?? "INC0";
      const body = buildClaimBody(orderNo, incident, "UT-TSHIRT-BLK-M", "Product damaged");
      const now = new Date().toISOString();
      emailDb.emails = [
        {
          _id: newId(),
          subject,
          sender: AJIO_SENDER,
          status: "new",
          receivedAt: now,
          matchingPattern: "ajio_return_claim",
          snippet: `Dear Seller, the customer has raised a return claim. Incident ID: ${incident}.`,
          body,
          bodyRaw: body,
          retryAttempts: 0,
          mailboxId: mb._id,
          replyDetail: null,
          meta: { header: { date: now }, customerOrderNo: orderNo, incidentId: incident },
        },
        ...emailDb.emails,
      ];
    } else {
      const next = emailDb.emails.find((e) => e.status === "fetched" && mailboxOf(e)?.status === "connected");
      if (next) sendReply(next);
    }
    onUpdate();
  }, intervalMs);
  return () => window.clearInterval(timer);
};

export const EmailAutomationService = {
  listEmails,
  fetchEmails,
  getEmailCounts,
  listEmailsByStatus,
  exportEmails,
  getEmailDetails,
  retryBulkEmails,
  replyToEmail,
  forceReplyToEmail,
  markManualReply,
  getTodayStats,
  getPendingEmailCount,
  getManualFixContext,
  previewAwbLink,
  linkAwbAndSend,
  addVideoLinkAndSend,
  subscribeEmailUpdates,
};
