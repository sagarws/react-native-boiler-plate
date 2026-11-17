import { daysAgo, seeded } from "@/mocks/delay";
import type { ExternalOrder, ImportJobSummary } from "@/types/imports";
import type { ScannedParcelOrders } from "@/types/master-data";

/** Forward ↔ return AWB links created by "Forward and Return AWB linking" imports, plus scan-parcel notification results. */

const VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const PLATFORMS = ["ajio", "myntra", "amazon", "flipkart", "delhivery", "xbees"] as const;

const digits = (rand: () => number, n: number): string => Array.from({ length: n }, () => Math.floor(rand() * 10)).join("");

function build(count: number): ExternalOrder[] {
  const rand = seeded(1313);
  return Array.from({ length: count }, (_, i) => {
    const platform = PLATFORMS[Math.floor(rand() * PLATFORMS.length)];
    const day = Math.floor(rand() * 30);
    const type = rand() > 0.5 ? "return" : "forward";
    return {
      _id: `ext${String(i + 1).padStart(21, "0")}`,
      userId: "64f0c0ffee0000000000a001",
      companyId: "64f0c0ffee0000000000c001",
      fileKey: `external/${platform}${type === "return" ? "Return" : "Forward"}Sheet.xlsx`,
      return_awb: `RT${digits(rand, 10)}`,
      forward_awb: `14${digits(rand, 11)}`,
      forward_video_link: rand() > 0.3 ? VIDEO : "",
      return_video_link: rand() > 0.4 ? VIDEO : "",
      import_platform: platform,
      import_type: type,
      createdAt: daysAgo(day, 10 + (i % 8)),
      updatedAt: daysAgo(day, 11),
      __v: 0,
    };
  });
}

export const externalOrdersSeed: ExternalOrder[] = build(37);

function awbList(seed: number, count: number): string[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => `RT${digits(rand, 10)}`);
}

/** Keyed by notification id (`/imports?id=<id>` from the notifications menu). */
export const scannedParcelSeed: Record<string, ScannedParcelOrders> = {
  ntf000000000000000000002: {
    notificationId: "ntf000000000000000000002",
    parcelCondition: "bad",
    successfulOrders: awbList(77, 38),
    failedOrders: awbList(91, 2),
    createdAt: daysAgo(0, 8),
  },
};

/** Fallback for ids the seed does not know (e.g. notifications created during the session). */
export function scannedParcelFallback(notificationId: string): ScannedParcelOrders {
  const seed = notificationId.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return {
    notificationId,
    parcelCondition: seed % 2 ? "good" : "bad",
    successfulOrders: awbList(seed, 6 + (seed % 9)),
    failedOrders: awbList(seed + 5, seed % 4),
    createdAt: new Date().toISOString(),
  };
}

// ---------- mock sheet parsing (shared by every upload service) ----------

export interface ParsedSheet {
  fileName: string;
  /** Data rows (header excluded). Estimated from the size for .xlsx / .xls. */
  rowCount: number;
  /** CSV only: header + rows split on commas (quoted cells supported). */
  header: string[];
  rows: string[][];
}

const ACCEPTED_SHEET = /\.(csv|xlsx|xls)$/i;
const MAX_SHEET_BYTES = 25 * 1024 * 1024;

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  // Excel "=\"123\"" text cells (D2C export) → 123
  return cells.map((c) => c.replace(/^="(.*)"$/, "$1"));
}

/** Validates the picked file like the BE does and "parses" it. Throws `Error` with the BE message on bad input. */
export async function mockParseSheet(file: FormDataEntryValue | null, label = "file"): Promise<ParsedSheet> {
  if (!(file instanceof File)) throw new Error(`Please select a ${label} to upload`);
  if (!ACCEPTED_SHEET.test(file.name)) throw new Error("Invalid file type. Only .csv, .xlsx and .xls files are allowed.");
  if (file.size === 0) throw new Error(`${file.name} is empty.`);
  if (file.size > MAX_SHEET_BYTES) throw new Error("File is too large. Maximum size is 25 MB.");
  if (/\.csv$/i.test(file.name)) {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error(`${file.name} has no data rows.`);
    const [head, ...body] = lines.map(splitCsvLine);
    return { fileName: file.name, rowCount: body.length, header: head, rows: body };
  }
  return { fileName: file.name, rowCount: Math.max(3, Math.min(4000, Math.round(file.size / 140))), header: [], rows: [] };
}

let lastImportAt = 0;
let jobCounter = 0;

/** Builds the import result; a second import within 4s is "queued" (TrackVid HTTP 202). */
export function mockImportSummary(sheet: ParsedSheet, inserted: number, label: string): ImportJobSummary {
  const now = Date.now();
  const queued = now - lastImportAt < 4000;
  lastImportAt = now;
  jobCounter += 1;
  const total = sheet.rowCount;
  const failed = Math.min(total - Math.min(inserted, total), Math.floor(total * 0.04));
  const updated = Math.max(0, total - Math.min(inserted, total) - failed);
  const errors = Array.from({ length: Math.min(failed, 5) }, (_, i) => `Row ${8 + i * 11}: required column is empty, row skipped.`);
  return {
    jobId: `job-${now.toString(36)}-${jobCounter}`,
    message: queued
      ? "Your file has been queued. It will be processed automatically when the current import finishes."
      : `${label} imported successfully`,
    fileName: sheet.fileName,
    totalRecords: total,
    inserted: Math.min(inserted, total),
    updated,
    failed,
    queued,
    errors,
  };
}
