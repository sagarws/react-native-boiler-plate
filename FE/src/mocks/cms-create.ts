import { sampleClaims } from "@/mocks/cms";
import type { BulkClaimCsvRow } from "@/types/cms-create";

/**
 * Mock data for the CMS create / update screen: VMS screenshots, master-data order info and the Increff bulk-claim
 * report. Built from the Manage SPF Claims sample rows so an AWB copied from /cms auto-fills here.
 */

/** Platforms with an Automated-Scripts runner (BE `validations/claimAutomation.validation.ts`), normalised keys. */
export const AUTOMATION_PLATFORMS: string[] = ["ajio", "myntra", "meesho", "snapdeal", "flipkart", "nykaa", "tatacliq"];

const FRAME_TONES = ["#0f766e", "#1d4ed8", "#9333ea", "#c2410c", "#be123c", "#4d7c0f", "#0369a1"];

/** A VMS frame grab as an inline SVG (no network needed). */
export function frameImage(awb: string, index: number, side: "Return" | "Forward"): string {
  const tone = FRAME_TONES[(awb.length + index) % FRAME_TONES.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">` +
    `<rect width="640" height="400" fill="${tone}"/>` +
    `<rect x="40" y="40" width="560" height="320" rx="18" fill="#ffffff22" stroke="#ffffff88" stroke-width="3"/>` +
    `<text x="320" y="190" font-family="Arial, sans-serif" font-size="34" fill="#fff" text-anchor="middle">${side} frame ${index + 1}</text>` +
    `<text x="320" y="240" font-family="Arial, sans-serif" font-size="22" fill="#ffffffcc" text-anchor="middle">AWB ${awb}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function hash(value: string): number {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Return-side VMS screenshots: 0 for about a third of AWBs, otherwise 4–6 frames. */
export function returnScreenshotsFor(awb: string): string[] {
  const h = hash(awb);
  if (h % 3 === 0) return [];
  return Array.from({ length: 4 + (h % 3) }, (_, i) => frameImage(awb, i, "Return"));
}

/** Forward-side screenshots: 2 frames when the forward AWB is known. */
export function forwardScreenshotsFor(awb: string): string[] {
  return hash(awb) % 4 === 0 ? [] : [frameImage(awb, 0, "Forward"), frameImage(awb, 1, "Forward")];
}

export const LOGISTICS_PARTNERS = ["Delhivery", "Bluedart", "Ecom", "Xpressbees", "Shadowfax", "Valmo"];

/** Meesho / Snapdeal / Myntra master rows keyed off the sample claims. */
export const masterOrders = sampleClaims.map((row, i) => ({
  platform: row.eCommercePlatform.toLowerCase(),
  returnAwb: row.AWBNumber,
  forwardAwb: row.forwardAWB || "",
  subOrderNo: row.subOrderNumber || "",
  customerOrderNumber: row.customerOrderNumber || "",
  returnVideoLink: row.returnVideoLink || "",
  forwardVideoLink: row.forwardVideoLink || "",
  courierPartner: LOGISTICS_PARTNERS[i % LOGISTICS_PARTNERS.length],
}));

const csvRow = (rowNumber: number, awb: string, channel: string, qc: string, sku: string, fwd: string, price: string): BulkClaimCsvRow => ({
  rowNumber,
  returnOrderType: "CUSTOMER_RETURN",
  salesChannel: channel,
  returnGateEntryAwb: awb,
  qcReason: qc,
  clientSkuIdEan: sku,
  forwardAwbNumber: fwd,
  forwardUnitBasePrice: price,
});

/** Rows used when an Excel file is uploaded (the mock reads CSV text only). */
export function sampleBulkRows(): BulkClaimCsvRow[] {
  const ajio = sampleClaims.filter((c) => c.eCommercePlatform.toLowerCase() === "ajio").slice(0, 7);
  const myntra = sampleClaims.filter((c) => c.eCommercePlatform.toLowerCase() === "myntra").slice(0, 2);
  const qc = ["SHORT QUANTITY", "DAMAGE PRODUCT RECEIVED", "EMPTY BOX RECEIVED", "DIFFERENT BRAND PRODUCT RECEIVED", "", "PARTIAL ARTICLES RECEIVED", "SHORT QUANTITY"];
  const rows = ajio.map((c, i) => csvRow(i + 2, c.AWBNumber, "AJIO", qc[i % qc.length], c.seller_sku || "", c.forwardAWB || "", String(799 + i * 150)));
  rows.push(...myntra.map((c, i) => csvRow(rows.length + i + 2, c.AWBNumber, "MYNTRA", "Damaged Returns", c.seller_sku || "", c.forwardAWB || "", "1299")));
  rows.push(csvRow(rows.length + 2, "1490000000000", "AJIO", "SHORT QUANTITY", "UT-KRT-BLU-M", "", "899"));
  rows.push(csvRow(rows.length + 2, "1490999999999", "AJIO", "EMPTY BOX RECEIVED", "DD-JNS-32-BLK", "", "1499"));
  return rows;
}

/** CSV header the Increff QC report uses (same column order as `BulkClaimCsvRow`). */
export const BULK_CLAIM_HEADERS = [
  "Return Order Type",
  "Sales Channel",
  "Return Gate Entry AWB",
  "QC Reason",
  "Client SKU ID / EAN",
  "Forward AWB Number",
  "Forward Unit Base Price",
];
