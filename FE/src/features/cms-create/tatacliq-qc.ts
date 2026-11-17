/**
 * Tata CliQ QC-fail vocabulary (TrackVid-FE `helper/tatacliqQc.ts`). The portal's own form: twelve reason codes,
 * a sub-reason only for Wrong Product ("10"), six named image slots (four required) and two video URLs for the
 * reasons that want footage.
 */

export interface QcReason {
  code: string;
  label: string;
}

export const TATACLIQ_QC_REASONS: QcReason[] = [
  { code: "06", label: "Product Carrier Damage - In-transit damage by Logistic partner" },
  { code: "10", label: "Wrong Product" },
  { code: "11", label: "Used Product" },
  { code: "12", label: "Damaged Product" },
  { code: "13", label: "Damaged Box" },
  { code: "14", label: "Missing Box" },
  { code: "15", label: "Missing Accessories" },
  { code: "16", label: "Missing Product/Empty Box" },
  { code: "17", label: "Partial Product" },
  { code: "18", label: "Seal Open" },
  { code: "19", label: "Delivered but not received" },
  { code: "20", label: "Price Mismatch" },
];

export const TATACLIQ_QC_SUB_REASONS: Record<string, QcReason[]> = {
  "10": [
    { code: "01", label: "Other brand delivered" },
    { code: "02", label: "Local product delivered" },
    { code: "03", label: "Same brand but different SKU delivered" },
    { code: "04", label: "Same brand but different size delivered" },
  ],
};

const REASONS_WITHOUT_VIDEO = new Set(["06", "13", "14", "18", "19", "20"]);

export const needsSubReason = (code: string): boolean => Boolean(TATACLIQ_QC_SUB_REASONS[String(code || "").trim()]);

export const needsVideo = (code: string): boolean => {
  const reason = String(code || "").trim();
  if (!reason) return false;
  return !REASONS_WITHOUT_VIDEO.has(reason);
};

export const subReasonsFor = (code: string): QcReason[] => TATACLIQ_QC_SUB_REASONS[String(code || "").trim()] ?? [];

export const qcReasonLabel = (code: string): string => TATACLIQ_QC_REASONS.find((r) => r.code === String(code || "").trim())?.label ?? "";

const same = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

const CLAIM_TYPE_KEY_CODES: Record<string, string> = {
  tatacliq_wrong_other_brand: "01",
  tatacliq_wrong_local_product: "02",
  tatacliq_wrong_same_brand_sku: "03",
  tatacliq_wrong_same_brand_size: "04",
};

const resolve = (value: string, options: QcReason[]): string => {
  const wanted = String(value || "").trim();
  if (!wanted) return "";
  const fromKey = CLAIM_TYPE_KEY_CODES[wanted.toLowerCase()];
  const byKey = fromKey && options.some((o) => o.code === fromKey) ? fromKey : "";
  return byKey || options.find((o) => o.code === wanted)?.code || options.find((o) => same(o.label, wanted))?.code || "";
};

/** The portal's reason + sub-reason codes derived from the claim-type cascade (parent = reason, child = claim type). */
export const qcSelectionFromClaimType = (parentSelection: string, typeOfClaim: string): { reason: string; subReason: string } => {
  const fromTypeOfClaim = resolve(typeOfClaim, TATACLIQ_QC_REASONS);
  const fromParent = resolve(parentSelection, TATACLIQ_QC_REASONS);
  const reason = fromTypeOfClaim || fromParent;
  if (!reason || !needsSubReason(reason)) return { reason, subReason: "" };
  const other = fromTypeOfClaim ? parentSelection : typeOfClaim;
  return { reason, subReason: resolve(other, subReasonsFor(reason)) };
};

export interface QcImageSlot {
  slot: number;
  key: string;
  label: string;
  required: boolean;
}

export const TATACLIQ_QC_IMAGE_SLOTS: QcImageSlot[] = [
  { slot: 1, key: "productImage", label: "Product Image", required: true },
  { slot: 2, key: "productCode", label: "IMEI No./Sr. No./Product Code", required: true },
  { slot: 3, key: "brandMarking", label: "Brand/Company marking", required: true },
  { slot: 4, key: "packingSlip", label: "Packing slip", required: true },
  { slot: 5, key: "additional1", label: "Additional Image 1", required: false },
  { slot: 6, key: "additional2", label: "Additional Image 2", required: false },
];

export const requiredQcImageSlots = (): QcImageSlot[] => TATACLIQ_QC_IMAGE_SLOTS.filter((s) => s.required);
