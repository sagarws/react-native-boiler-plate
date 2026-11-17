import { CLAIM_HISTORY_ACTION_TYPE } from "@/config/app-constant";
import { CMS_STATUS } from "@/config/constant";
import { NAMED_PLATFORM_SET, OTHER_TAB, hasValue, platformTabOf, usernameOf } from "@/features/cms/cms-rules";
import { toCsv } from "@/lib/download";
import { AJIO_STORES, ajioArticlesFor, sampleClaims, sampleMasterRecords, seedSession } from "@/mocks/cms";
import { clone, delay, newId } from "@/mocks/delay";
import { appendClaimHistory } from "@/services/claimHistory-service";
import { UserService } from "@/services/user-service";
import type {
  AjioApplyData,
  AjioApplyPayload,
  AjioSyncData,
  AjioSyncPayload,
  AjioSyncRow,
  ApiBody,
  BulkStatusResult,
  ChangeCmsStatusPayload,
  CmsCounts,
  CmsExportPayload,
  CmsListPayload,
  CmsListResponse,
  CompanyCredential,
  CompanyCredentials,
  CredentialProvider,
  CredentialSession,
  EditTicketPayload,
  ICms,
  MasterSyncApplyData,
  MasterSyncApplyPayload,
  MasterSyncCandidateRow,
  MasterSyncField,
  RenewSessionPayload,
  RunReturnScriptData,
  RunReturnScriptPayload,
  UpdateCmsPayload,
  UpdateCmsStatusPayload,
} from "@/types/cms";

/**
 * Mock of TrackVid-FE `api/cms-service.ts` (same exported object and function names). Each function resolves to
 * the BE response body (`{ isSuccess, displayMessage, data }`) and throws `Error` for not-found / validation
 * failures. Claims live in memory for the page session.
 */

let claims: ICms[] = clone(sampleClaims);
/** AJIO Drive conversions in flight: cmsId → time it finishes (checked on read, so no timers here). */
const driveReadyAt = new Map<string, number>();
const sessions = new Map<string, CredentialSession | null>();

const ok = <T,>(data: T, displayMessage = "Success"): ApiBody<T> => ({ isSuccess: true, displayMessage, data });
const lower = (v: string | undefined) => (v || "").toLowerCase().trim();

function findClaim(id: string): ICms {
  const row = claims.find((c) => c._id === id);
  if (!row) throw new Error("Claim not found.");
  return row;
}

function patchClaim(id: string, patch: (row: ICms) => ICms): ICms {
  const next = patch(clone(findClaim(id)));
  claims = claims.map((c) => (c._id === id ? next : c));
  return next;
}

function settleDriveConversions(): void {
  const now = Date.now();
  for (const [id, readyAt] of driveReadyAt) {
    if (readyAt > now) continue;
    driveReadyAt.delete(id);
    claims = claims.map((c) => (c._id === id ? { ...c, driveStatus: "uploaded", driveError: undefined } : c));
  }
}

function parseDay(value: string, endOfDay: boolean): number {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return endOfDay ? Number.POSITIVE_INFINITY : 0;
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
}

function matchesPlatform(row: ICms, platforms: readonly string[], otherPlatforms?: readonly string[]): boolean {
  if (!platforms.length) return true;
  const p = lower(row.eCommercePlatform);
  return platforms.some((name) => {
    if (name === OTHER_TAB) {
      if (otherPlatforms?.length) return otherPlatforms.some((o) => lower(o) === p);
      return !NAMED_PLATFORM_SET.has(p) && platformTabOf(row.eCommercePlatform) === OTHER_TAB;
    }
    return lower(name) === p || (lower(name) === "nykaa" && (p === "nykaa fashion" || p === "naykaa"));
  });
}

function searchHit(row: ICms, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [row.AWBNumber, row.forwardAWB, row.ticketNumber, row.subOrderNumber, row.customerOrderNumber, row.seller_sku, row.order_Brand]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle));
}

type Skip = { status?: boolean; platform?: boolean };

function filterClaims(p: Partial<CmsListPayload>, skip: Skip = {}): ICms[] {
  const from = p.startDate ? parseDay(p.startDate, false) : 0;
  const to = p.endDate ? parseDay(p.endDate, true) : Number.POSITIVE_INFINITY;
  const search = (p.search ?? "").trim();
  return claims.filter((row) => {
    const created = new Date(row.createdAt).getTime();
    if (created < from || created > to) return false;
    if (!searchHit(row, search)) return false;
    if (p.feedId?.length && !p.feedId.includes(row.feedId ?? "")) return false;
    if (p.brand?.length && !p.brand.includes(row.order_Brand ?? "")) return false;
    if (!skip.platform && !matchesPlatform(row, p.eCommercePlatform ?? [], p.otherPlatforms)) return false;
    if (p.username && usernameOf(row) !== p.username) return false;
    if (!skip.status && p.status && row.status !== p.status) return false;
    return true;
  });
}

function sortClaims(rows: ICms[], sortBy?: string, sortOrder?: "asc" | "desc"): ICms[] {
  if (!sortBy) return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const dir = sortOrder === "asc" ? 1 : -1;
  const value = (r: ICms): string | number => {
    if (sortBy === "processCount") return Number(r.processCount ?? 0);
    if (sortBy === "compensationAmount") return Number(r.compensationAmount ?? 0);
    if (sortBy === "ecommerce_account_username") return usernameOf(r).toLowerCase();
    if (sortBy === "feed") return (r.feed?.name ?? "").toLowerCase();
    const raw = (r as unknown as Record<string, unknown>)[sortBy];
    return typeof raw === "number" ? raw : String(raw ?? "").toLowerCase();
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    return va < vb ? -dir : va > vb ? dir : 0;
  });
}

/** POST /cms — paged claim list + brand / username filter options. */
const getCmsList = async (payload: CmsListPayload & { sortBy?: string; sortOrder?: "asc" | "desc" }): Promise<CmsListResponse> => {
  await delay(450);
  settleDriveConversions();
  const rows = sortClaims(filterClaims(payload), payload.sortBy, payload.sortOrder);
  const start = Math.max(0, (payload.page - 1) * payload.limit);
  const scope = claims.filter((r) => matchesPlatform(r, payload.eCommercePlatform, payload.otherPlatforms));
  return {
    isSuccess: true,
    displayMessage: "Claims fetched successfully",
    data: { cms: clone(rows.slice(start, start + payload.limit)), metadata: { total: rows.length, page: payload.page, limit: payload.limit } },
    filters: {
      brand: [...new Set(scope.map((r) => r.order_Brand).filter((b): b is string => Boolean(b)))].sort(),
      usernames: [...new Set(scope.map(usernameOf).filter(Boolean))].sort(),
    },
  };
};

/** POST /cms/counts — status chips (current platform) and platform chips (current status). */
const getCmsCounts = async (payload: CmsListPayload): Promise<ApiBody<CmsCounts>> => {
  await delay(250);
  settleDriveConversions();
  const statusCounts: Record<string, number> = {};
  const byStatus = filterClaims(payload, { status: true });
  statusCounts.All = byStatus.length;
  for (const r of byStatus) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  const platformCounts: Record<string, number> = {};
  for (const r of filterClaims(payload, { platform: true })) {
    const others = payload.otherPlatforms ?? [];
    const tab = others.some((o) => lower(o) === lower(r.eCommercePlatform)) ? OTHER_TAB : platformTabOf(r.eCommercePlatform);
    platformCounts[tab] = (platformCounts[tab] ?? 0) + 1;
  }
  return ok({ statusCounts, platformCounts });
};

const EXPORT_HEADERS = [
  "E-commerce Platform",
  "Ticket",
  "Return AWB",
  "Scanned Number",
  "Sub Order No",
  "Seller SKU",
  "POB ID",
  "Status",
  "Type of Claim",
  "Brand",
  "Username",
  "Feed Name",
  "Return Delivery Date",
  "Forward Order Date",
  "Create Date - Time",
] as const;

/**
 * POST /cms/excel. The real endpoint returns an .xlsx blob; no spreadsheet library is installed here, so the
 * mock returns the same columns as CSV (Excel opens it).
 */
const downloadExcelSheet = async (payload: CmsExportPayload): Promise<Blob> => {
  await delay(600);
  const base = sortClaims(filterClaims(payload));
  const rows = payload.selectedClaims.length
    ? base.filter((r) => payload.selectedClaims.includes(r._id))
    : base.slice(Math.max(0, (payload.page - 1) * payload.limit), Math.max(0, (payload.page - 1) * payload.limit) + payload.limit);
  const csv = toCsv([
    [...EXPORT_HEADERS],
    ...rows.map((r) => [
      r.eCommercePlatform,
      r.ticketNumber,
      r.AWBNumber,
      r.forwardAWB,
      r.subOrderNumber,
      r.seller_sku,
      r.pobid,
      r.status,
      r.typeOfClaim,
      r.order_Brand,
      usernameOf(r),
      r.feed?.name,
      r.returnDeliveryDate,
      r.forwardOrderDate,
      r.createdAt,
    ]),
  ]);
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
};

/** PUT /cms/update-mail-template/:id */
const updateMailTemplate = async (id: string, payload: { subject: string; body: string }): Promise<ApiBody<null>> => {
  await delay(500);
  const row = patchClaim(id, (r) => ({ ...r, emailTemplate: { _id: id, subject: payload.subject, body: payload.body } }));
  appendClaimHistory(row.history, row._id, { action_type: CLAIM_HISTORY_ACTION_TYPE.EMAIL_TEMPLATE_UPDATED, description: "Claim email template updated" });
  return ok(null, "Email template updated successfully");
};

let lastJobAt = 0;

/** POST /cms/runReturnScript — queues the auto-claim worker for the given claims. */
const setReturnClaim = async (payload: RunReturnScriptPayload): Promise<ApiBody<RunReturnScriptData>> => {
  await delay(600);
  settleDriveConversions();
  const rows = payload.ids.map(findClaim);
  const drivePending = rows.filter((r) => lower(r.eCommercePlatform) === "ajio" && (r.driveStatus === "pending" || r.driveStatus === "failed"));
  if (drivePending.length) {
    return { isSuccess: false, displayMessage: "AJIO Drive links are still being prepared. Please retry in a few moments.", data: { drivePending: true } };
  }
  const capped = rows.filter((r) => !payload.overrideRetryLimit && Number(r.processCount ?? 0) >= 3);
  if (capped.length === rows.length) {
    return { isSuccess: false, displayMessage: "All selected claims have reached the retry limit.", data: {} };
  }
  const now = Date.now();
  // A second dispatch within a few seconds lands behind the first job, like the BE queue.
  const queued = now - lastJobAt < 4000;
  lastJobAt = now;
  const ids = new Set(rows.filter((r) => !capped.includes(r)).map((r) => r._id));
  claims = claims.map((c) =>
    ids.has(c._id) ? { ...c, scriptProcessingStatus: queued ? "Queued" : "Running", scriptProcessingError: null, processCount: Number(c.processCount ?? 0) + 1 } : c,
  );
  return ok(
    { jobId: `job-${newId()}`, status: queued ? "queued" : "active", queuePosition: queued ? 2 : undefined, totalInQueue: queued ? 2 : undefined },
    queued ? "Job queued" : "Script started successfully",
  );
};

/** PUT /cms/update-ticket — add or change the marketplace ticket number. */
const editCmsTicket = async (payload: EditTicketPayload): Promise<ApiBody<null>> => {
  await delay(450);
  const ticket = payload.ticket.trim();
  if (!ticket) throw new Error("Ticket is required");
  const before = findClaim(payload._id);
  const hadTicket = Boolean(before.ticketNumber);
  const movesToReview = before.status === CMS_STATUS.PENDING || before.status === CMS_STATUS.FAILED_TO_PROCEED;
  const row = patchClaim(payload._id, (r) => ({
    ...r,
    ticketNumber: ticket,
    processingMode: "manual",
    status: movesToReview ? CMS_STATUS.IN_REVIEW : r.status,
    scriptProcessingStatus: movesToReview ? "Completed" : r.scriptProcessingStatus,
  }));
  appendClaimHistory(row.history, row._id, {
    action_type: hadTicket ? CLAIM_HISTORY_ACTION_TYPE.TICKET_UPDATED : CLAIM_HISTORY_ACTION_TYPE.TICKET_ADDED,
    description: hadTicket ? `Ticket updated from ${before.ticketNumber} to ${ticket}` : `Ticket ${ticket} added`,
  });
  if (movesToReview) {
    appendClaimHistory(row.history, row._id, {
      action_type: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_PENDING_TO_IN_REVIEW,
      description: `Status changed from ${before.status} to In Review`,
    });
  }
  return ok(null, "Ticket updated successfully");
};

function statusAction(from: string, to: string): number {
  const key = `${from}->${to}`;
  const map: Record<string, number> = {
    [`${CMS_STATUS.PENDING}->${CMS_STATUS.IN_REVIEW}`]: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_PENDING_TO_IN_REVIEW,
    [`${CMS_STATUS.IN_REVIEW}->${CMS_STATUS.APPROVED}`]: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_IN_REVIEW_TO_APPROVED,
    [`${CMS_STATUS.IN_REVIEW}->${CMS_STATUS.REJECTED}`]: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_IN_REVIEW_TO_REJECTED,
    [`${CMS_STATUS.APPROVED}->${CMS_STATUS.IN_REVIEW}`]: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_APPROVED_TO_IN_REVIEW,
    [`${CMS_STATUS.APPROVED}->${CMS_STATUS.REJECTED}`]: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_APPROVED_TO_REJECTED,
    [`${CMS_STATUS.APPROVED}->${CMS_STATUS.PENDING}`]: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_APPROVED_TO_PENDING,
    [`${CMS_STATUS.REJECTED}->${CMS_STATUS.IN_REVIEW}`]: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_REJECTED_TO_IN_REVIEW,
    [`${CMS_STATUS.REJECTED}->${CMS_STATUS.APPROVED}`]: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_REJECTED_TO_APPROVED,
    [`${CMS_STATUS.REJECTED}->${CMS_STATUS.PENDING}`]: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_REJECTED_TO_PENDING,
    [`${CMS_STATUS.IN_REVIEW}->${CMS_STATUS.PENDING}`]: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_IN_REVIEW_TO_PENDING,
  };
  return map[key] ?? 0;
}

function setStatus(id: string, status: string, reason?: string): void {
  const before = findClaim(id);
  if (status === CMS_STATUS.REJECTED && !reason?.trim()) throw new Error("Reason is required");
  const row = patchClaim(id, (r) => ({ ...r, status, rejectReason: status === CMS_STATUS.REJECTED ? reason?.trim() : r.rejectReason }));
  appendClaimHistory(row.history, row._id, {
    action_type: statusAction(before.status, status),
    description: `Status changed from ${before.status} to ${status}${reason ? `. Reason: ${reason.trim()}` : ""}`,
  });
}

/** PUT /cms/update-cms-status — Approve / Reject (with reason) a claim. */
const updateCmsStatus = async (payload: UpdateCmsStatusPayload): Promise<ApiBody<null>> => {
  await delay(450);
  setStatus(payload._id, payload.status, payload.reason);
  return ok(null, `Claim ${payload.status === CMS_STATUS.REJECTED ? "rejected" : "status updated"} successfully`);
};

/** PUT /cms/change-cms-status — bulk status change. */
const changeCmsStatus = async (payload: ChangeCmsStatusPayload): Promise<ApiBody<{ updated: number }>> => {
  await delay(500);
  for (const id of payload.ids) setStatus(id, payload.status, payload.status === CMS_STATUS.REJECTED ? "Bulk status change" : undefined);
  return ok({ updated: payload.ids.length }, `${payload.ids.length} claim(s) moved to ${payload.status}`);
};

/** PUT /cms/save-otp — hands the Snapdeal OTP to the waiting script. */
const saveOtp = async (payload: { jobId: string; otp: string }): Promise<ApiBody<null>> => {
  await delay(500);
  if (!/^\d{4,8}$/.test(payload.otp.trim())) throw new Error("Enter the OTP you received (4 to 8 digits).");
  return ok(null, "OTP submitted");
};

function assignUsername(row: ICms, username: string | undefined): ICms {
  const p = lower(row.eCommercePlatform);
  const value = username || undefined;
  if (p === "ajio") return { ...row, ajio_account_email: value };
  if (p === "meesho") return { ...row, meesho_account_email: value };
  if (p === "snapdeal") return { ...row, snapdeal_account_username: value };
  if (p === "myntra") return { ...row, myntraClaimDetails: { ...row.myntraClaimDetails, username: value } };
  if (p === "nykaa") return { ...row, nykaaClaimDetails: { ...row.nykaaClaimDetails, username: value } };
  return { ...row, otherClaimDetails: { ...row.otherClaimDetails, username: value } };
}

const HANDLED_UPDATE_KEYS = new Set([
  "cmsId",
  "eCommercePlatform",
  "username",
  "clearUsername",
  "disputedAmount",
  "physicalReceivedSku",
  "disputeAmount",
  "domestic",
  "skuName",
  "pobId",
  "sixSideImages",
]);

/** POST /cms/updateCMS — partial update used by the edit modals and `/cms/update`. */
const updateCMS = async (payload: UpdateCmsPayload): Promise<ApiBody<ICms>> => {
  await delay(550);
  const current = findClaim(payload.cmsId);
  const p = lower(current.eCommercePlatform);
  if (p === "xbees" && payload.disputeAmount !== undefined && !(Number(payload.disputeAmount) > 0)) throw new Error("Dispute Amount must be a positive number");
  if (p === "delhivery" && payload.domestic !== undefined && !["EXPRESS", "SURFACE"].includes(payload.domestic)) throw new Error("Select a valid Domestic option");
  if (payload.AWBNumber !== undefined && !payload.AWBNumber.trim()) throw new Error("Return AWB is required");
  const row = patchClaim(payload.cmsId, (r) => {
    let next: ICms = { ...r };
    if (payload.clearUsername) next = assignUsername(next, undefined);
    else if (payload.username) next = assignUsername(next, payload.username);
    if (payload.disputedAmount !== undefined) next.myntraClaimDetails = { ...next.myntraClaimDetails, disputedAmount: payload.disputedAmount };
    if (payload.physicalReceivedSku !== undefined) next.myntraClaimDetails = { ...next.myntraClaimDetails, physicalReceivedSku: payload.physicalReceivedSku };
    if (payload.disputeAmount !== undefined) next.otherClaimDetails = { ...next.otherClaimDetails, disputeAmount: payload.disputeAmount };
    if (payload.domestic !== undefined) next.otherClaimDetails = { ...next.otherClaimDetails, domestic: payload.domestic };
    if (payload.skuName) next.seller_sku = payload.skuName;
    if (payload.pobId) next.pobid = payload.pobId;
    if (payload.sixSideImages) next.sixSideImages = { fileKey: payload.sixSideImages, createdAt: new Date().toISOString() };
    // Remaining scalar keys map 1:1 onto the claim (AWBNumber, forwardAWB, typeOfClaim, remark, …).
    const bag = next as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(payload)) {
      if (HANDLED_UPDATE_KEYS.has(key) || value === undefined) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") bag[key] = typeof value === "string" ? value.trim() : value;
    }
    return next;
  });
  return ok(clone(row), "Claim updated successfully");
};

/** DELETE /cms/:id */
const deleteCMS = async (id: string): Promise<ApiBody<null>> => {
  await delay(500);
  const row = findClaim(id);
  if (row.status !== CMS_STATUS.PENDING) throw new Error("Only Pending claims can be deleted.");
  claims = claims.filter((c) => c._id !== id);
  return ok(null, "Claim deleted successfully");
};

/** POST /cms/:id/retry-drive — re-queue the AJIO S3 → Google Drive link conversion. */
const retryDriveConversion = async (id: string): Promise<ApiBody<null>> => {
  await delay(400);
  patchClaim(id, (r) => ({ ...r, driveStatus: "pending", driveError: undefined }));
  driveReadyAt.set(id, Date.now() + 6000);
  return ok(null, "Drive conversion re-queued.");
};

function readCsvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
}

/** POST /cms/bulk-status-update — sheet with Ticket No + Status columns. */
const bulkStatusUpdate = async (file: File, marketplace: string): Promise<ApiBody<BulkStatusResult>> => {
  await delay(900);
  const market = lower(marketplace);
  const isAjio = market === "ajio";
  const inScope = (r: ICms) => lower(r.eCommercePlatform) === market && (isAjio ? r.status !== CMS_STATUS.PENDING : r.status === CMS_STATUS.IN_REVIEW);
  let sheet: { ticketId: string; status: string }[] = [];
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    const [header = [], ...body] = readCsvRows(await file.text());
    const ti = header.findIndex((h) => /ticket/i.test(h));
    const si = header.findIndex((h) => /status/i.test(h));
    if (ti < 0 || si < 0) throw new Error("The sheet needs a Ticket No column and a Status column.");
    sheet = body.map((cells) => ({ ticketId: cells[ti] ?? "", status: cells[si] ?? "" }));
  } else {
    // .xlsx cannot be read without a spreadsheet library: simulate a sheet built from this platform's tickets.
    const tickets = claims.filter(inScope).slice(0, 6);
    sheet = [
      ...tickets.map((r, i) => ({ ticketId: r.ticketNumber ?? "", status: i % 3 === 2 ? CMS_STATUS.REJECTED : CMS_STATUS.APPROVED })),
      { ticketId: "TKT00000000", status: CMS_STATUS.APPROVED },
      { ticketId: "", status: CMS_STATUS.APPROVED },
      { ticketId: "TKT11111111", status: "Pending" },
    ];
  }
  const result: BulkStatusResult = { marketplace, totalRows: 0, scannedRows: sheet.length, ignoredCount: 0, updatedCount: 0, skippedCount: 0, notFoundCount: 0, updated: [], skipped: [], notFound: [] };
  sheet.forEach((line, idx) => {
    const rowNumber = idx + 2;
    const status = [CMS_STATUS.APPROVED, CMS_STATUS.REJECTED].find((s) => lower(s) === lower(line.status));
    if (!isAjio && !status) {
      result.ignoredCount = (result.ignoredCount ?? 0) + 1;
      return;
    }
    result.totalRows += 1;
    if (!line.ticketId) {
      result.skipped.push({ rowNumber, ticketId: "", reason: "Ticket No is empty" });
      return;
    }
    const target = status ?? line.status;
    const row = claims.find((r) => inScope(r) && r.ticketNumber === line.ticketId);
    if (!row) {
      result.notFound.push({ rowNumber, ticketId: line.ticketId });
      return;
    }
    if (row.status === target) {
      result.skipped.push({ rowNumber, ticketId: line.ticketId, reason: `Already ${target}` });
      return;
    }
    setStatus(row._id, target, target === CMS_STATUS.REJECTED ? "Rejected by marketplace (bulk sheet)" : undefined);
    result.updated.push({ rowNumber, ticketId: line.ticketId, newStatus: target });
  });
  result.updatedCount = result.updated.length;
  result.skippedCount = result.skipped.length;
  result.notFoundCount = result.notFound.length;
  return ok(result, `${result.updatedCount} record(s) updated`);
};

// ----- Company credentials (Integrations "Session" column) -----

const PROVIDER_SESSION_KEY: Record<CredentialProvider, keyof CompanyCredential | null> = {
  ajio: "ajioSession",
  meesho: "meeshoSession",
  snapdeal: "snapdealSession",
  myntra: "myntraSession",
  nykaa: "nykaaSession",
  flipkart: "flipkartSession",
  delhivery: "delhiverySession",
  xbees: "xbeesSession",
  tatacliq: null,
};

const providerOf = (platform: string): CredentialProvider | null => {
  const key = lower(platform).replace(/\s+/g, "");
  const normalized = key === "nykaafashion" ? "nykaa" : key === "expressbees" ? "xbees" : key;
  return normalized in PROVIDER_SESSION_KEY ? (normalized as CredentialProvider) : null;
};

/** Stable id for a seller-portal credential (`<provider>:<username>`); Integrations matches rows with it. */
export function credentialIdFor(platform: string, username: string): string {
  return `${providerOf(platform) ?? lower(platform)}:${username}`;
}

/** GET /cms/my-company-credentials — the company's credentials with cached session metadata (never secrets). */
const getMyCompanyCredentials = async (): Promise<ApiBody<CompanyCredentials>> => {
  const user = await UserService.getUser();
  const out: CompanyCredentials = {};
  for (const entry of user.company.settings.eCommercePlatformLoginInfo ?? []) {
    const provider = providerOf(entry.eComPlatform);
    if (!provider) continue;
    const sessionKey = PROVIDER_SESSION_KEY[provider];
    out[provider] = entry.info.map((info, i) => {
      const credentialId = credentialIdFor(entry.eComPlatform, info.username);
      if (!sessions.has(credentialId)) sessions.set(credentialId, seedSession(provider, i));
      const cred: CompanyCredential = { credentialId, username: info.username, is_verified: info.is_verified };
      if (sessionKey) (cred as unknown as Record<string, unknown>)[sessionKey] = clone(sessions.get(credentialId) ?? null);
      return cred;
    });
  }
  return ok(out);
};

/** POST /cms/renew-session — forces a fresh seller-portal login (slow on purpose, like the real one). */
const renewSession = async (payload: RenewSessionPayload): Promise<ApiBody<{ session: CredentialSession }>> => {
  await delay(2600);
  const creds = (await getMyCompanyCredentials()).data;
  const provider = providerOf(payload.platform);
  const found = provider ? creds[provider]?.find((c) => c.credentialId === payload.credentialId) : undefined;
  if (!found) throw new Error("Credential not found for this company.");
  const now = Date.now();
  const session: CredentialSession = {
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 24 * 3_600_000).toISOString(),
    ip: "103.21.58.77",
    source: "manual-renew",
    cookieNames: ["session", "csrftoken"],
    userId: provider === "ajio" ? "AJS1000" : null,
    pobCount: provider === "ajio" ? 3 : undefined,
  };
  sessions.set(payload.credentialId, session);
  return ok({ session }, `Session renewed for ${found.username}`);
};

// ----- Master Sync -----

const SYNC_FIELDS: { key: MasterSyncField; rowValue: (r: ICms) => string | undefined }[] = [
  { key: "forwardAWB", rowValue: (r) => r.forwardAWB },
  { key: "skuName", rowValue: (r) => r.seller_sku },
  { key: "pobId", rowValue: (r) => r.pobid },
];

const SYNC_STATUSES = new Set<string>([CMS_STATUS.PENDING, CMS_STATUS.FAILED_TO_PROCEED]);

function masterLinesFor(row: ICms) {
  return sampleMasterRecords.filter((m) => m.awb === row.AWBNumber || (row.forwardAWB && m.forwardAWB === row.forwardAWB));
}

/** POST /cms/master-sync-candidates — what master data can offer each selected claim (read-only). */
const masterSyncCandidates = async (payload: { ids: string[] }): Promise<ApiBody<MasterSyncCandidateRow[]>> => {
  await delay(700);
  const rows = payload.ids.map((id): MasterSyncCandidateRow => {
    const row = claims.find((c) => c._id === id);
    if (!row) return { cmsId: id, eligible: false, reason: "Claim not found" };
    const base = { cmsId: id, AWBNumber: row.AWBNumber, forwardAWB: row.forwardAWB, seller_sku: row.seller_sku, pobid: row.pobid, status: row.status, eCommercePlatform: row.eCommercePlatform };
    if (!SYNC_STATUSES.has(row.status)) return { ...base, eligible: false, reason: `Only Pending and Failed to Proceed claims are synced (this one is ${row.status})` };
    const isAjio = lower(row.eCommercePlatform) === "ajio";
    const missing: Record<MasterSyncField, boolean> = {
      forwardAWB: !hasValue(row.forwardAWB),
      skuName: !hasValue(row.seller_sku),
      pobId: isAjio && !hasValue(row.pobid),
    };
    if (!missing.forwardAWB && !missing.skuName && !missing.pobId) return { ...base, eligible: false, reason: "Forward AWB, Seller SKU and POB ID are already filled" };
    const lines = masterLinesFor(row);
    const uniq = (vals: string[]) => [...new Set(vals.filter((v) => hasValue(v)))];
    const candidates: Record<MasterSyncField, string[]> = {
      forwardAWB: missing.forwardAWB ? uniq(lines.map((l) => l.forwardAWB)) : [],
      skuName: missing.skuName ? uniq(lines.map((l) => l.sku)) : [],
      pobId: missing.pobId ? uniq(lines.map((l) => l.pobId)) : [],
    };
    return { ...base, eligible: true, missing, candidates };
  });
  return ok(rows);
};

/** POST /cms/master-sync-apply — fills blank fields of ONE claim with the chosen master values. */
const masterSyncApply = async (payload: MasterSyncApplyPayload): Promise<ApiBody<MasterSyncApplyData>> => {
  await delay(350);
  const current = findClaim(payload.cmsId);
  const applied: Partial<Record<MasterSyncField, string>> = {};
  const skipped: { field: string; reason: string }[] = [];
  for (const f of SYNC_FIELDS) {
    const value = payload[f.key];
    if (!value) continue;
    if (hasValue(f.rowValue(current))) skipped.push({ field: f.key, reason: "already has a value" });
    else applied[f.key] = value;
  }
  const row = patchClaim(payload.cmsId, (r) => ({
    ...r,
    forwardAWB: applied.forwardAWB ?? r.forwardAWB,
    seller_sku: applied.skuName ?? r.seller_sku,
    pobid: applied.pobId ?? r.pobid,
  }));
  return ok({ cmsId: row._id, applied, skipped, forwardAWB: row.forwardAWB ?? "", seller_sku: row.seller_sku ?? "", pobid: row.pobid ?? "" });
};

// ----- AJIO SKU + POB sync -----

/** POST /cms/ajio-sku-pob-sync — one call per AJIO account; asks AJIO's return APIs about the claims. */
const ajioSkuPobSync = async (payload: AjioSyncPayload): Promise<ApiBody<AjioSyncData>> => {
  await delay(1500);
  const username = payload.credentialId.split(":").slice(1).join(":") || "AJIO";
  const results: AjioSyncRow[] = [];
  const skipped: { cmsId: string; reason: string }[] = [];
  for (const id of payload.ids) {
    const idx = claims.findIndex((c) => c._id === id);
    const row = claims[idx];
    if (!row) {
      skipped.push({ cmsId: id, reason: "Claim not found" });
      continue;
    }
    if (lower(row.eCommercePlatform) !== "ajio") {
      skipped.push({ cmsId: id, reason: `${row.AWBNumber} is not an AJIO claim` });
      continue;
    }
    if (!SYNC_STATUSES.has(row.status)) {
      skipped.push({ cmsId: id, reason: `${row.AWBNumber} is ${row.status}` });
      continue;
    }
    const currentPobId = hasValue(row.pobid) ? (row.pobid ?? "") : "";
    const currentSku = row.seller_sku ?? "";
    const base = { cmsId: id, awb: row.AWBNumber, currentPobId, currentSku, articles: [] as AjioSyncRow["articles"] };
    if (idx % 7 === 5) {
      results.push({ ...base, outcome: "not_found", pobId: "", storeName: "" });
      continue;
    }
    if (idx % 11 === 3) {
      results.push({ ...base, outcome: "not_claimable", pobId: "", storeName: "", reason: "AJIO holds no return detail for this AWB." });
      continue;
    }
    // Most rows agree with what is stored; every fifth one disagrees so the "Differs from CMS" bucket shows up.
    const disagrees = idx % 5 === 0;
    const pobId = currentPobId && !disagrees ? currentPobId : ["POB1029", "POB1047", "POB2210"][idx % 3];
    const storeName = AJIO_STORES[pobId] ?? "";
    const articles = ajioArticlesFor(row.AWBNumber, idx).map((a, k) => (k === 0 && currentSku && !disagrees ? { ...a, sku: currentSku } : a));
    const matched = articles.find((a) => a.sku === currentSku);
    if (articles.length > 1 && !matched) {
      results.push({ ...base, outcome: "choose_sku", pobId, storeName, articles, returnOrderId: `RO${row.AWBNumber.slice(-6)}` });
      continue;
    }
    const resolvedSku = matched?.sku ?? articles[0].sku;
    const differs = (currentPobId && currentPobId !== pobId) || (currentSku && currentSku !== resolvedSku && !matched);
    results.push({
      ...base,
      outcome: differs ? "differs" : "filled",
      pobId,
      storeName,
      articles: differs && articles.length > 1 ? articles : [],
      resolvedSku,
      selectedReturnItemId: (matched ?? articles[0]).returnItemId,
      skuUnchanged: currentSku === resolvedSku,
      reason: differs ? "AJIO's answer differs from what the claim has stored." : undefined,
    });
  }
  return ok({ username, results, unresolved: [], skipped, partial: false });
};

/** POST /cms/ajio-sku-pob-apply — writes the reviewed set in one go. */
const ajioSkuPobApply = async (payload: AjioApplyPayload): Promise<ApiBody<AjioApplyData>> => {
  await delay(700);
  let wrote = 0;
  const failed: { cmsId: string; reason: string }[] = [];
  for (const u of payload.updates) {
    const row = claims.find((c) => c._id === u.cmsId);
    if (!row) {
      failed.push({ cmsId: u.cmsId, reason: "Claim not found" });
      continue;
    }
    const pob = u.pobId && (u.overwrite || !hasValue(row.pobid)) ? u.pobId : undefined;
    const sku = u.skuName && (u.overwrite || !hasValue(row.seller_sku)) ? u.skuName : undefined;
    if (!pob && !sku) {
      failed.push({ cmsId: u.cmsId, reason: "Field already has a value (overwrite not chosen)" });
      continue;
    }
    patchClaim(u.cmsId, (r) => ({ ...r, pobid: pob ?? r.pobid, seller_sku: sku ?? r.seller_sku }));
    wrote += 1;
  }
  return ok({ wrote, failed }, `Applied ${wrote} claim(s)`);
};

/**
 * Not a TrackVid endpoint: lets the mock create screen (/cms/create) put new claims into this list,
 * the way the real backend would after POST /cms/createCMS.
 */
export function addClaim(row: Pick<ICms, "_id" | "eCommercePlatform" | "AWBNumber"> & Partial<ICms>): void {
  if (claims.some((c) => c.AWBNumber === row.AWBNumber && c.eCommercePlatform.toLowerCase() === row.eCommercePlatform.toLowerCase())) return;
  const full: ICms = { status: "Pending", createdAt: new Date().toISOString(), history: `hist-${row._id}`, ...row };
  claims = [full, ...claims];
}

export const CmsService = {
  getCmsList,
  updateMailTemplate,
  setReturnClaim,
  downloadExcelSheet,
  editCmsTicket,
  updateCmsStatus,
  changeCmsStatus,
  saveOtp,
  updateCMS,
  deleteCMS,
  bulkStatusUpdate,
  getCmsCounts,
  retryDriveConversion,
  masterSyncCandidates,
  masterSyncApply,
  getMyCompanyCredentials,
  renewSession,
  ajioSkuPobSync,
  ajioSkuPobApply,
};

/**
 * Master-data lookup by AWB, as TrackVid's edit modal gets it from `api/cms-autofetch-service.getOrderByAwb`
 * (owned by the CMS create screen). Kept here so the Manage SPF Claims edit modal does not depend on that route.
 */
export const cmsMasterLookup = {
  async getOrderByAwb(awb: string, side: "Return" | "Forward"): Promise<{ records: { _id: string; sku: string; pobId: string }[] }> {
    await delay(350);
    const records = sampleMasterRecords.filter((m) => (side === "Return" ? m.awb === awb : m.forwardAWB === awb)).map(({ _id, sku, pobId }) => ({ _id, sku, pobId }));
    if (!records.length) throw new Error(`No master data for ${side} AWB ${awb}`);
    return { records };
  },
};

/**
 * Mock-only stand-in for the auto-claim worker. The page drives it from timers (simulating the
 * `cms:script:progress` socket); each call settles one claim the way `handleScriptCallback` would.
 * Not part of TrackVid's API surface.
 */
export const cmsScriptMock = {
  markRunning(ids: readonly string[]): void {
    const set = new Set(ids);
    claims = claims.map((c) => (set.has(c._id) && c.scriptProcessingStatus === "Queued" ? { ...c, scriptProcessingStatus: "Running" } : c));
  },
  /** Returns whether the claim hit the retry cap and moved to Failed to Proceed. */
  settle(id: string, outcome: "success" | "failed" | "help-center", error?: string): { awb: string; capped: boolean } {
    const before = claims.find((c) => c._id === id);
    if (!before) return { awb: "", capped: false };
    if (outcome === "success") {
      const ticket = `${before.eCommercePlatform.slice(0, 2).toUpperCase()}${String(Date.now()).slice(-8)}`;
      const row = patchClaim(id, (r) => ({ ...r, scriptProcessingStatus: "Success", scriptProcessingError: null, ticketNumber: ticket, processingMode: "automated", status: CMS_STATUS.IN_REVIEW }));
      appendClaimHistory(row.history, row._id, { action_type: CLAIM_HISTORY_ACTION_TYPE.TICKET_ADDED, description: `Ticket ${ticket} added`, byAutomation: true, feedName: "Auto Claim" });
      appendClaimHistory(row.history, row._id, { action_type: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_PENDING_TO_IN_REVIEW, description: "Status changed from Pending to In Review", byAutomation: true, feedName: "Auto Claim" });
      return { awb: row.AWBNumber, capped: false };
    }
    const capped = Number(before.processCount ?? 0) >= 3;
    const row = patchClaim(id, (r) => ({
      ...r,
      // The BE resets a failed row to "Not Started" so it stays retryable; at the cap it moves to Failed to Proceed.
      scriptProcessingStatus: capped ? "Not Started" : outcome === "help-center" ? "Help Center Failed" : "Failed",
      scriptProcessingError: error ?? "Processing failed",
      status: capped ? CMS_STATUS.FAILED_TO_PROCEED : r.status,
    }));
    return { awb: row.AWBNumber, capped };
  },
};
