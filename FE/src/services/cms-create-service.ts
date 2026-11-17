import { CMS_STATUS } from "@/config/constant";
import { AUTOMATION_PLATFORMS, sampleBulkRows } from "@/mocks/cms-create";
import { sampleClaims } from "@/mocks/cms";
import { addClaim } from "@/services/cms-service";
import { clone, delay, newId } from "@/mocks/delay";
import { samplePlatforms } from "@/mocks/user";
import type {
  ApiEnvelope,
  AutomationPlatformsData,
  BulkClaimCheckResponse,
  BulkClaimCreateRow,
  BulkClaimCsvRow,
  BulkClaimVerifyPayloadRow,
  BulkClaimVerifyRow,
  CreateCmsBody,
  ExistingCmsPreview,
  StoreVideoData,
  StoredFile,
  UploadImageData,
} from "@/types/cms-create";

/**
 * Mock of TrackVid-FE `api/cms-create-service.ts` (same exported function names). The real calls are multipart
 * posts; here they read the same `FormData` and keep the result in memory for the page session. The three
 * bulk-claim calls are the `/cms/bulk-claim-*` posts TrackVid's `BulkClaimModal` makes inline.
 */

const ok = <T,>(data: T, displayMessage = "Success"): ApiEnvelope<T> => ({ isSuccess: true, displayMessage, data });
const norm = (v: string) => v.toLowerCase().trim().replace(/[\s_-]+/g, "");

/** Uploaded file key → preview URL (an inline placeholder: the mock never stores the bytes). */
const uploads = new Map<string, string>();
/** Claims created on this screen during the session (looked up by `findCmsByAwb`). */
let createdClaims: ExistingCmsPreview[] = [];

function placeholderFor(name: string, kind: "Image" | "PDF" | "Video"): string {
  const safe = name.replace(/[<>&"']/g, "").slice(0, 40);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">` +
    `<rect width="480" height="300" fill="#e7eef0"/>` +
    `<text x="240" y="140" font-family="Arial, sans-serif" font-size="24" fill="#0f5f6e" text-anchor="middle">Uploaded ${kind}</text>` +
    `<text x="240" y="178" font-family="Arial, sans-serif" font-size="16" fill="#4b6b72" text-anchor="middle">${safe}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function fileFrom(formData: FormData): File {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file was attached.");
  return file;
}

/** GET /cms/automation-platforms — platforms with an Automated-Scripts runner. */
export const getAutomationPlatforms = async (): Promise<ApiEnvelope<AutomationPlatformsData>> => {
  await delay(250);
  return ok({ platforms: [...AUTOMATION_PLATFORMS] });
};

/** POST /cms/uploadImage — image or PDF → S3 key. */
export const uploadCmsImage = async (formData: FormData): Promise<ApiEnvelope<UploadImageData>> => {
  await delay(500);
  const file = fileFrom(formData);
  const isPdf = file.type === "application/pdf";
  if (!isPdf && !file.type.startsWith("image/")) throw new Error("*Unsupported File Format");
  if (file.size > 10 * 1024 * 1024) throw new Error("File must be smaller than 10 MB");
  const key = `cms/${newId()}-${file.name.replace(/\s+/g, "_")}`;
  const url = placeholderFor(file.name, isPdf ? "PDF" : "Image");
  uploads.set(key, url);
  return ok({ key, url }, "File uploaded successfully");
};

/** POST /cms/storeVideo — video file → VMS video id. */
export const storeCmsVideo = async (formData: FormData): Promise<ApiEnvelope<StoreVideoData>> => {
  await delay(900);
  const file = fileFrom(formData);
  if (!file.type.startsWith("video/")) throw new Error("*Unsupported File Format");
  const key = `cms/videos/${newId()}-${file.name.replace(/\s+/g, "_")}`;
  const url = placeholderFor(file.name, "Video");
  uploads.set(key, url);
  return ok({ _id: newId(), key, url }, "Video stored successfully");
};

/** DELETE /files/:fileKey */
export const deleteCmsFile = async (fileKey: string): Promise<ApiEnvelope<null>> => {
  await delay(250);
  uploads.delete(fileKey);
  return ok(null, "File deleted");
};

const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};

function json(fd: FormData, key: string): Record<string, unknown> | null {
  const raw = text(fd, key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    // A malformed bundle is reported by the required-field checks below, not here.
    return null;
  }
}

const stored = (key: string): StoredFile | null => (key ? { fileKey: key, url: uploads.get(key) ?? key } : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const storedList = (v: unknown): StoredFile[] =>
  Array.isArray(v)
    ? v
        .map((item): string => (typeof item === "string" ? item : item && typeof item === "object" ? str((item as { fileKey?: unknown }).fileKey) : ""))
        .filter(Boolean)
        .map((k) => ({ fileKey: k, url: uploads.get(k) ?? k }))
    : [];

/** Session claims created here — read by `cms-autofetch-service.findCmsByAwb`. Mock only. */
export function getCreatedClaims(): ExistingCmsPreview[] {
  return clone(createdClaims);
}

/** Applies a /cms/update to a claim created on this screen (the list service does not know these rows). */
export function patchCreatedClaim(id: string, patch: Partial<ExistingCmsPreview>): boolean {
  const hit = createdClaims.some((c) => c._id === id);
  if (hit) createdClaims = createdClaims.map((c) => (c._id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c));
  return hit;
}

/** POST /cms/createCMS — multipart create. `autoClaim` ("true" / "false") is always sent by the page. */
export const createCMS = async (formData: FormData): Promise<CreateCmsBody> => {
  await delay(900);
  const platformId = text(formData, "eCommercePlatform");
  const platform = samplePlatforms.find((p) => p._id === platformId)?.name ?? platformId;
  const awb = text(formData, "AWBNumber");
  if (!platform) throw new Error("E-commerce platform is required");
  if (!awb) throw new Error("AWB number is required");
  if (!text(formData, "typeOfClaim")) throw new Error("Type of claim is required");
  const exists =
    createdClaims.some((c) => c.AWBNumber === awb && norm(c.eCommercePlatform) === norm(platform)) ||
    sampleClaims.some((c) => c.AWBNumber === awb && norm(c.eCommercePlatform) === norm(platform));
  if (exists) throw new Error(`A claim already exists for AWB ${awb} on ${platform}. Open it from Manage SPF Claims to edit it.`);

  const other = json(formData, "otherClaimDetails");
  const myntra = json(formData, "myntraClaimDetails");
  const nykaa = json(formData, "nykaaClaimDetails");
  const now = new Date().toISOString();
  const row: ExistingCmsPreview = {
    _id: newId(),
    eCommercePlatform: platform,
    AWBNumber: awb,
    typeOfClaim: text(formData, "typeOfClaim"),
    forwardAWB: text(formData, "forwardAWB"),
    customerOrderNumber: text(formData, "customerOrderNumber"),
    remark: text(formData, "remark"),
    status: CMS_STATUS.PENDING,
    ticketNumber: "",
    returnVideoLink: text(formData, "returnVideoLink"),
    forwardVideoLink: text(formData, "forwardVideoLink"),
    returnProductImage: stored(text(formData, "returnProductImage"))?.url ?? "",
    forwardSentProductImage: stored(text(formData, "forwardSentProductImage"))?.url ?? "",
    sixSideImages: text(formData, "sixSideImages") ? (uploads.get(text(formData, "sixSideImages")) ?? "") : "",
    podProof: stored(text(formData, "podProof"))?.url ?? "",
    myntraClaimDetails: myntra
      ? {
          shippingLabelImage: stored(str(myntra.shippingLabelImage)),
          packingImages: storedList(myntra.packingImages),
          damagedProductVideoLink: str(myntra.damagedProductVideoLink),
          disputedAmount: str(myntra.disputedAmount),
          physicalReceivedSku: str(myntra.physicalReceivedSku),
          username: str(myntra.username),
        }
      : null,
    nykaaClaimDetails: nykaa
      ? { vendorCode: str(nykaa.vendorCode), skuId: str(nykaa.skuId), returnType: (["RTO", "DTO", "REPL"].includes(str(nykaa.returnType)) ? str(nykaa.returnType) : "") as "" | "RTO" | "DTO" | "REPL", username: str(nykaa.username) }
      : null,
    otherClaimDetails: other
      ? {
          parentSelection: str(other.parentSelection),
          claimArea: str(other.claimArea),
          shipmentIssue: str(other.shipmentIssue),
          subcategory: str(other.subcategory),
          domestic: str(other.domestic),
          fulfillmentChannel: str(other.fulfillmentChannel),
          disputeAmount: str(other.disputeAmount),
          username: str(other.username),
          qcReason: str(other.qcReason),
          qcSubReason: str(other.qcSubReason),
          packagingVideoUrl: str(other.packagingVideoUrl),
          unboxingVideoUrl: str(other.unboxingVideoUrl),
          shippingLabelImage: stored(str(other.shippingLabelImage)),
          serialNumberImage: stored(str(other.serialNumberImage)),
          packingImages: storedList(other.packingImages),
          contentsOfReturnImages: storedList(other.contentsOfReturnImages),
          qcImages:
            other.qcImages && typeof other.qcImages === "object"
              ? Object.fromEntries(Object.entries(other.qcImages as Record<string, unknown>).map(([slot, key]) => [slot, stored(str(key)) ?? ""]))
              : undefined,
        }
      : null,
    barcodeImage: stored(text(formData, "barcodeImage")),
    receivedProductImage_1: stored(text(formData, "receivedProductImage_1")),
    reverseWayBillImage: stored(text(formData, "reverseWayBillImage")),
    outerPackageImage_1: stored(text(formData, "outerPackageImage_1")),
    outerPackageImage_2: stored(text(formData, "outerPackageImage_2")),
    innerPackageImage_1: stored(text(formData, "innerPackageImage_1")),
    innerPackageImage_2: stored(text(formData, "innerPackageImage_2")),
    productImage_1: stored(text(formData, "productImage_1")),
    productImage_2: stored(text(formData, "productImage_2")),
    podImage_1: stored(text(formData, "podImage_1")),
    podImage_2: stored(text(formData, "podImage_2")),
    subOrderNumber: text(formData, "subOrderNumber"),
    packetId: text(formData, "packetId"),
    logisticsPartnerName: text(formData, "logisticsPartnerName"),
    stateOfThePacket: text(formData, "stateOfThePacket"),
    costOfMissingArticle: text(formData, "costOfMissingArticle"),
    createdAt: now,
    updatedAt: now,
    ajio_account_email: text(formData, "ajio_account_email"),
    meesho_account_email: text(formData, "meesho_account_email"),
    snapdeal_account_username: text(formData, "snapdeal_account_username"),
    pobid: text(formData, "pobId"),
    skuName: text(formData, "skuName"),
  };
  createdClaims = [row, ...createdClaims];
  addClaim({
    _id: row._id,
    eCommercePlatform: row.eCommercePlatform,
    AWBNumber: row.AWBNumber,
    typeOfClaim: row.typeOfClaim,
    forwardAWB: row.forwardAWB,
    customerOrderNumber: row.customerOrderNumber,
    remark: row.remark,
    status: CMS_STATUS.PENDING,
    ticketNumber: "",
    returnVideoLink: row.returnVideoLink,
    forwardVideoLink: row.forwardVideoLink,
  });

  const data = { _id: row._id, AWBNumber: awb, eCommercePlatform: platform };
  if (text(formData, "autoClaim") !== "true") return { isSuccess: true, displayMessage: "CMS created successfully", data };
  if (!AUTOMATION_PLATFORMS.includes(norm(platform))) {
    return {
      isSuccess: true,
      displayMessage: `Claim created. Auto claim not started: ${platform} has no automation runner.`,
      data,
      autoClaim: { requested: true, dispatched: false, reason: "no-runner" },
    };
  }
  return {
    isSuccess: true,
    displayMessage: "Claim created and sent for ticket creation",
    data,
    autoClaim: { requested: true, dispatched: true, jobId: `job-${row._id}` },
  };
};

/** Marks a session claim as ticketed once the simulated runner finishes (mock only). */
export function settleCreatedClaim(id: string, success: boolean): string {
  const ticket = success ? `TV${String(Date.now()).slice(-8)}` : "";
  patchCreatedClaim(id, success ? { ticketNumber: ticket, status: CMS_STATUS.IN_REVIEW } : {});
  return ticket;
}

// ----- Bulk claim (Increff QC report) -----

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(textBody: string): BulkClaimCsvRow[] {
  const lines = textBody.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("The file has no data rows.");
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const idx = {
    type: col("returnordertype"),
    channel: col("saleschannel", "channel"),
    awb: col("returngateentryawb", "gateentryawb", "returnawb", "awb"),
    qc: col("qcreason", "reason"),
    sku: col("clientskuid", "ean", "sku"),
    fwd: col("forwardawb"),
    price: col("forwardunitbaseprice", "baseprice", "price"),
  };
  if (idx.awb < 0) throw new Error("Could not find the Return Gate Entry AWB column.");
  return lines.slice(1).map((line, i) => {
    const c = splitCsvLine(line);
    const at = (n: number) => (n >= 0 ? (c[n] ?? "") : "");
    return {
      rowNumber: i + 2,
      returnOrderType: at(idx.type),
      salesChannel: at(idx.channel),
      returnGateEntryAwb: at(idx.awb),
      qcReason: at(idx.qc),
      clientSkuIdEan: at(idx.sku),
      forwardAwbNumber: at(idx.fwd),
      forwardUnitBasePrice: at(idx.price),
    };
  });
}

const ALLOWED_INCREFF = new Set(["ajio"]);

/** POST /cms/bulk-claim-check — parse the report and match each Return AWB against VMS. */
export const bulkClaimCheck = async (formData: FormData, signal?: AbortSignal): Promise<ApiEnvelope<BulkClaimCheckResponse>> => {
  const file = fileFrom(formData);
  const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
  const rows = isCsv ? parseCsv(await file.text()) : sampleBulkRows();
  await delay(900);
  if (signal?.aborted) throw new Error("Request cancelled");
  let skippedByPlatform = 0;
  const matched: BulkClaimCheckResponse["matched"] = [];
  const unmatched: BulkClaimCheckResponse["unmatched"] = [];
  for (const row of rows) {
    if (row.salesChannel && !ALLOWED_INCREFF.has(norm(row.salesChannel))) {
      skippedByPlatform += 1;
      unmatched.push({ csvRow: row, reason: `${row.salesChannel} is not allowed in Increff allocation` });
      continue;
    }
    const hit = sampleClaims.find((c) => c.AWBNumber === row.returnGateEntryAwb);
    if (!row.returnGateEntryAwb || !hit) {
      unmatched.push({ csvRow: row, reason: row.returnGateEntryAwb ? "No VMS record for this AWB" : "Return AWB is empty" });
      continue;
    }
    matched.push({
      csvRow: row,
      vmsList: [{ _id: `vms-${hit._id}`, awbNo: hit.AWBNumber, eCommercePlatform: hit.eCommercePlatform, orderType: "Return", orderCondition: 1, createdAt: hit.createdAt }],
    });
  }
  return ok(
    { totalRows: rows.length, matchedCount: matched.length, unmatchedCount: unmatched.length, matched, unmatched, skippedByPlatform },
    `${matched.length} of ${rows.length} row(s) matched a VMS record`,
  );
};

/** POST /cms/bulk-claim-verify — resolve the QC reason to a claim type and list missing fields per row. */
export const bulkClaimVerify = async (payload: { rows: BulkClaimVerifyPayloadRow[] }, signal?: AbortSignal): Promise<ApiEnvelope<{ results: BulkClaimVerifyRow[] }>> => {
  await delay(800);
  if (signal?.aborted) throw new Error("Request cancelled");
  const results = payload.rows.map((r): BulkClaimVerifyRow => {
    const catalogue = samplePlatforms.find((p) => norm(p.name) === norm(r.platform))?.typeOfClaims ?? [];
    const resolved = catalogue.find((c) => norm(c.name) === norm(r.qcReason) || norm(c.key ?? "") === norm(r.qcReason));
    const missing: string[] = [];
    if (!r.qcReason) missing.push("QC Reason");
    else if (!resolved) missing.push(`QC Reason "${r.qcReason}" does not match a claim type`);
    if (!r.clientSkuIdEan) missing.push("Client SKU ID / EAN");
    return { rowNumber: r.rowNumber, isValid: missing.length === 0, resolvedTypeOfClaim: resolved?.name ?? null, missingFields: missing };
  });
  return ok({ results }, "Rows verified");
};

/** POST /cms/bulk-claim-create — create one claim per verified row. */
export const bulkClaimCreate = async (payload: { rows: BulkClaimVerifyPayloadRow[] }): Promise<ApiEnvelope<{ results: BulkClaimCreateRow[] }>> => {
  await delay(1200);
  const results = payload.rows.map((r): BulkClaimCreateRow => {
    if (createdClaims.some((c) => c.AWBNumber === r.returnGateEntryAwb && norm(c.eCommercePlatform) === norm(r.platform))) {
      return { rowNumber: r.rowNumber, isSuccess: false, error: "Claim already exists for this AWB" };
    }
    const id = newId();
    const now = new Date().toISOString();
    createdClaims = [
      {
        _id: id,
        eCommercePlatform: r.platform,
        AWBNumber: r.returnGateEntryAwb,
        typeOfClaim: r.qcReason,
        forwardAWB: r.forwardAwbNumber,
        customerOrderNumber: "",
        remark: "Created from the Increff bulk claim report",
        status: CMS_STATUS.PENDING,
        ticketNumber: "",
        returnVideoLink: "",
        forwardVideoLink: "",
        returnProductImage: "",
        forwardSentProductImage: "",
        sixSideImages: "",
        podProof: "",
        myntraClaimDetails: null,
        nykaaClaimDetails: null,
        otherClaimDetails: null,
        subOrderNumber: "",
        packetId: "",
        logisticsPartnerName: "",
        createdAt: now,
        updatedAt: now,
        skuName: r.clientSkuIdEan,
      },
      ...createdClaims,
    ];
    addClaim({ _id: id, eCommercePlatform: r.platform, AWBNumber: r.returnGateEntryAwb, typeOfClaim: r.qcReason, forwardAWB: r.forwardAwbNumber, status: CMS_STATUS.PENDING, createdAt: now });
    return { rowNumber: r.rowNumber, isSuccess: true, cmsId: id };
  });
  const created = results.filter((r) => r.isSuccess).length;
  return ok({ results }, `${created} claim(s) created, ${results.length - created} failed`);
};
