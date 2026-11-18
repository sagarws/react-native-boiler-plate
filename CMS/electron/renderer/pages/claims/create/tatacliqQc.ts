/**
 * Tata CliQ's QC-failure vocabulary, as the seller portal's own modal offers it.
 *
 * ⚠️ THE SOURCE OF TRUTH IS THE AUTOMATION CORE —
 * `@trackvid/automation-core/platforms/tatacliq/claim-management/common/qcReasons`.
 * That is what actually files the claim, and it validates the pair again before
 * submitting. This copy exists because neither this app nor TrackVid-BE depends
 * on the core (it is a Node package; this is a browser bundle), so the list
 * cannot be imported. Change one, change both — the same rule the session-expiry
 * constants carry.
 *
 * WHAT THE PORTAL DOES WITH THESE. The reason and sub-reason are sent as
 * `qcFailCIRDD` and `qcFailSubReasonCIRDD`; the six images are POSITIONAL, sent
 * one per `imgFile_{n}` field, and a reviewer reads them by position — so slot 1
 * is the product image whether or not slot 4 was filled. The two videos are
 * sent as URLs the portal fetches itself, not uploads.
 *
 * CODES ARE STRINGS and the leading zero is load-bearing — "06", not 6.
 */

export interface QcReason {
  code: string;
  label: string;
}

/** Reason for QC failure, in the portal's own order. */
export const TATACLIQ_QC_REASONS: QcReason[] = [
  {
    code: "06",
    label: "Product Carrier Damage - In-transit damage by Logistic partner",
  },
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

/**
 * Sub-reasons belong to Wrong Product and nothing else.
 *
 * Eleven of the twelve reasons say everything the portal wants on their own —
 * its own page clears the sub-reason select for them — so sending one with any
 * other reason sends a value the portal never sends.
 */
export const TATACLIQ_QC_SUB_REASONS: Record<string, QcReason[]> = {
  "10": [
    { code: "01", label: "Other brand delivered" },
    { code: "02", label: "Local product delivered" },
    { code: "03", label: "Same brand but different SKU delivered" },
    { code: "04", label: "Same brand but different size delivered" },
  ],
};

/**
 * Reasons that need no packaging or unboxing video.
 *
 * The six where the problem is evident from the photographs alone — a sealed
 * box, a missing box, a price mismatch. The other six are argued with footage,
 * which is why the fields appear for those and not these.
 */
const REASONS_WITHOUT_VIDEO = new Set(["06", "13", "14", "18", "19", "20"]);

/** Does this reason take a sub-reason at all? Only Wrong Product does. */
export const needsSubReason = (code: string): boolean =>
  Boolean(TATACLIQ_QC_SUB_REASONS[String(code || "").trim()]);

/** Should the claim carry the two video URLs? */
export const needsVideo = (code: string): boolean => {
  const reason = String(code || "").trim();

  // Nothing chosen yet: the fields stay hidden rather than appearing and then
  // vanishing once a reason is picked.
  if (!reason) return false;

  return !REASONS_WITHOUT_VIDEO.has(reason);
};

/** The sub-reasons for one reason. Empty when it takes none. */
export const subReasonsFor = (code: string): QcReason[] =>
  TATACLIQ_QC_SUB_REASONS[String(code || "").trim()] ?? [];

export const qcReasonLabel = (code: string): string =>
  TATACLIQ_QC_REASONS.find((reason) => reason.code === String(code || "").trim())?.label ?? "";

/** Case- and space-insensitive, so master data need not match punctuation exactly. */
const same = (a: string, b: string): boolean =>
  a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Claim-type KEYS that mean one of the portal's answers.
 *
 * The cascade stores `key || name` in `typeOfClaim`, and a key is snake_case —
 * so a claim type seeded as "Other brand delivered" arrives here as
 * `tatacliq_wrong_other_brand` and would match no label. These are the keys
 * TrackVid-BE seeds in `DefaultClaimsTataCliq`; change one, change both.
 *
 * Only the four Wrong Product sub-reasons need this. Every other reason is
 * matched from `parentSelection`, which carries the portal's label verbatim.
 */
const CLAIM_TYPE_KEY_CODES: Record<string, string> = {
  tatacliq_wrong_other_brand: "01",
  tatacliq_wrong_local_product: "02",
  tatacliq_wrong_same_brand_sku: "03",
  tatacliq_wrong_same_brand_size: "04",
};

/** A code, a label, or a seeded claim-type key, resolved to a code. */
const resolve = (value: string, options: QcReason[]): string => {
  const wanted = String(value || "").trim();

  if (!wanted) return "";

  const fromKey = CLAIM_TYPE_KEY_CODES[wanted.toLowerCase()];
  const byKey = fromKey && options.some((option) => option.code === fromKey) ? fromKey : "";

  return (
    byKey ||
    options.find((option) => option.code === wanted)?.code ||
    options.find((option) => same(option.label, wanted))?.code ||
    ""
  );
};

/**
 * The portal's QC codes, read off the claim-type cascade the operator filled in.
 *
 * WHY THIS EXISTS. The form used to ask the same question twice: the cascade on
 * the left in Tata CliQ's wording, and the portal's own two dropdowns on the
 * right. Only the right pair was sent to the marketplace, so the left one was
 * data entry that went nowhere — and an operator who filled in the obvious one
 * and missed the other got a claim no runner would file.
 *
 * ACCEPTS A CODE OR A LABEL, on purpose. A claim type keyed "10" resolves, and
 * so does one named "Wrong Product", so this works whether or not the master
 * data has been re-keyed to the portal's codes. Anything it cannot resolve
 * returns empty rather than guessing — filing under the wrong QC reason is
 * worse than not filing, because the marketplace rejects it days later and the
 * row looks like it was argued and lost.
 *
 * @param parentSelection the cascade's parent — the reason
 * @param typeOfClaim     the cascade's child — the sub-reason, where one applies
 */
export const qcSelectionFromClaimType = (
  parentSelection: string,
  typeOfClaim: string,
): { reason: string; subReason: string } => {
  // `typeOfClaim` IS TRIED FIRST, deliberately. It is the field the rest of
  // TrackVid reads — the email template, the reports, the claim lists — so when
  // it names a QC reason that is the reason, and the cascade's parent is then
  // free to be the sub-reason or a broader grouping.
  const fromTypeOfClaim = resolve(typeOfClaim, TATACLIQ_QC_REASONS);
  const fromParent = resolve(parentSelection, TATACLIQ_QC_REASONS);
  const reason = fromTypeOfClaim || fromParent;

  // Eleven of the twelve reasons take no sub-reason at all — the portal's own
  // page clears the select for them — so nothing is resolved for those.
  if (!reason || !needsSubReason(reason)) return { reason, subReason: "" };

  // Whichever of the two did NOT supply the reason is where the sub-reason can
  // be, so the pair works in either arrangement rather than depending on which
  // way round this company's master data is set up.
  const other = fromTypeOfClaim ? parentSelection : typeOfClaim;

  return { reason, subReason: resolve(other, subReasonsFor(reason)) };
};

export interface QcImageSlot {
  /** 1-6, and what the portal numbers the upload field with. */
  slot: number;
  /** Where the form stores it under `otherClaimDetails.qcImages`. */
  key: string;
  /** The portal's own label, asterisk included where it stars it. */
  label: string;
  required: boolean;
}

/**
 * The six image slots, in the order the portal numbers them.
 *
 * Named, not a generic list: the portal's modal labels each one, and a reviewer
 * opens them expecting the product in the first and the packing slip in the
 * fourth. An image in the wrong slot is a claim arguing the wrong thing, which
 * is why they are fixed slots here rather than an array the operator fills in
 * any order.
 */
export const TATACLIQ_QC_IMAGE_SLOTS: QcImageSlot[] = [
  { slot: 1, key: "productImage", label: "Product Image", required: true },
  { slot: 2, key: "productCode", label: "IMEI No./Sr. No./Product Code", required: true },
  { slot: 3, key: "brandMarking", label: "Brand/Company marking", required: true },
  { slot: 4, key: "packingSlip", label: "Packing slip", required: true },
  { slot: 5, key: "additional1", label: "Additional Image 1", required: false },
  { slot: 6, key: "additional2", label: "Additional Image 2", required: false },
];

/** The four the portal stars. Used by the form's validation message. */
export const requiredQcImageSlots = (): QcImageSlot[] =>
  TATACLIQ_QC_IMAGE_SLOTS.filter((slot) => slot.required);
