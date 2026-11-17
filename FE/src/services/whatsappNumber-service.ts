import { delay } from "@/mocks/delay";
import { mockImportSummary, mockParseSheet } from "@/mocks/imports";
import { addD2cRows, queueD2cRetries } from "@/services/masterData-service";
import type { RetryAllD2CResponse, WhatsAppNumberUploadResult } from "@/types/imports";

/** Mock of TrackVid-FE `api/whatsappNumber-service.ts`. */

const SAMPLE_HEADER = ["Order ID", "AWB Number", "Customer WhatsApp Number", "Customer Name"] as const;
/** BE retries at most this many failed D2C rows per click. */
const RETRY_BATCH = 25;

const col = (header: string[], name: string): number => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());

const uploadWhatsAppNumberFile = async (payload: FormData): Promise<WhatsAppNumberUploadResult> => {
  await delay(700);
  const sheet = await mockParseSheet(payload.get("file"));
  let parsed: { orderId: string; awb: string; phone: string; name: string }[];
  if (sheet.header.length) {
    const idx = SAMPLE_HEADER.map((h) => col(sheet.header, h));
    if (idx[1] < 0 || idx[2] < 0) throw new Error("Missing required columns: AWB Number, Customer WhatsApp Number.");
    parsed = sheet.rows.map((r) => ({ orderId: r[idx[0]] ?? "", awb: r[idx[1]] ?? "", phone: r[idx[2]] ?? "", name: idx[3] >= 0 ? (r[idx[3]] ?? "") : "" }));
  } else {
    parsed = Array.from({ length: Math.min(sheet.rowCount, 12) }, (_, i) => ({
      orderId: `UT${String(700000 + i)}`,
      awb: `${i % 4 === 3 ? "99" : "14"}${String(Date.now()).slice(-9)}${i}`,
      phone: `+91 98${String(76543210 + i).slice(0, 8)}`,
      name: "Customer",
    }));
  }
  const valid = parsed.filter((p) => p.awb && p.phone);
  addD2cRows(valid);
  // A message is only sent once the AWB / Order ID matches a VMS video. AWBs starting "14" have recordings in the mock.
  const unmatched = valid.filter((p) => !p.awb.startsWith("14")).map((p) => p.awb || p.orderId);
  const summary = mockImportSummary(sheet, valid.length, "WhatsApp numbers");
  return {
    ...summary,
    totalRecords: valid.length,
    failed: parsed.length - valid.length,
    matchChecked: true,
    matchedRecords: valid.length - unmatched.length,
    unmatchedRecords: unmatched.length,
    unmatchedIdentifiers: unmatched.slice(0, 5),
  };
};

/** TrackVid fetches an XLSX blob with the AWB column formatted as Text; the mock returns the same columns as CSV. */
const downloadWhatsAppNumberSample = async (): Promise<Blob> => {
  await delay(250);
  const csv = [SAMPLE_HEADER.join(","), 'UT100245,="1490823311245",+91 9876543210,Priya Nair', 'UT100246,="7912345678901",+91 9123456780,Rohan Gupta'].join("\n");
  return new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
};

const retryAllD2CWhatsAppMessages = async (): Promise<RetryAllD2CResponse> => {
  await delay(600);
  const { queued, remainingAfterBatch } = queueD2cRetries(RETRY_BATCH);
  return {
    message: queued > 0 ? `${queued} retries queued` : "No rows ready to retry",
    queued,
    remainingAfterBatch,
  };
};

export const whatsappNumberService = {
  uploadWhatsAppNumberFile,
  downloadWhatsAppNumberSample,
  retryAllD2CWhatsAppMessages,
};
