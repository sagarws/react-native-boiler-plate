import { CMS_STATUS, TEMP_PERMIT } from "@/config/constant";
import type { FileMetadata, ICms } from "@/types/cms";
import type { IUser } from "@/types/common";

/** Business rules from TrackVid-FE `pages/CMS.tsx` (module scope), shared by the page, columns and mock service. */

export interface PlatformTab {
  value: string;
  label: string;
  dot: string;
}

export const PLATFORM_TABS: readonly PlatformTab[] = [
  { value: "Ajio", label: "Ajio", dot: "#0088A3" },
  { value: "Meesho", label: "Meesho", dot: "#F43F5E" },
  { value: "Snapdeal", label: "Snapdeal", dot: "#E11D48" },
  { value: "Nykaa", label: "Nykaa Fashion", dot: "#EC4899" },
  { value: "Amazon", label: "Amazon", dot: "#F59E0B" },
  { value: "Myntra", label: "Myntra", dot: "#D946EF" },
  { value: "Flipkart", label: "Flipkart", dot: "#2563EB" },
  { value: "Tata CliQ", label: "Tata CliQ", dot: "#663399" },
  { value: "Delhivery", label: "Delhivery", dot: "#E31E24" },
  { value: "Xbees", label: "Xbees", dot: "#0E7C86" },
  { value: "Other", label: "Other", dot: "#5A6577" },
];
export const OTHER_TAB = "Other";

/** Hard cap on auto-claim retries (BE MAX_AUTO_CLAIM_ATTEMPTS). */
export const MAX_AUTO_CLAIM_ATTEMPTS = 3;

export const NAMED_PLATFORM_SET = new Set(PLATFORM_TABS.filter((p) => p.value !== OTHER_TAB).map((p) => p.value.toLowerCase()));
export const FULL_COLUMN_TABS = new Set(["Ajio", OTHER_TAB]);
export const BULK_STATUS_UPDATE_PLATFORMS = ["myntra", "meesho", "ajio"];
/** Swept by the BE cron, so the manual Auto Claim button is hidden (TEMP_PERMIT brings it back). */
export const AUTO_CLAIM_HIDDEN_PLATFORMS = new Set(["snapdeal", "myntra"]);
export const PLATFORM_BUNDLE_TABS = new Set(["Amazon", "Flipkart", "Tata CliQ", "Delhivery", "Xbees"]);
export const BUNDLE_TAB_COLUMNS: readonly string[] = [
  "eCommercePlatform",
  "ticketNumber",
  "processingMode",
  "AWBNumber",
  "status",
  "scriptProcessingStatus",
  "processCount",
  "scriptProcessingError",
  "emailFormate",
  "returnDeliveryDate",
  "outOfTat",
  "typeOfClaim",
  "order_Brand",
  "ecommerce_account_username",
  "forwardOrderDate",
  "feed",
  "images",
  "createdAt",
  "allResources",
  "history",
  "view",
  "delete",
];

export const RE_DISPATCH_BLOCKED_STATUSES = ["Queued", "Success", "Completed"];

export const POB_ID_REQUIRED_MESSAGE =
  "POB ID missing — AJIO rejects a claim without it. Import the master data carrying this AWB's POB ID, then retry.";
export const SUB_ORDER_REQUIRED_MESSAGE =
  "Sub-order number missing — the Meesho claim form is filled by it, so the claim cannot be raised. Import the master data carrying the sub-order number, then retry.";

/** Statuses only the AJIO tab strip shows; switching to another platform falls back to All. */
export const AJIO_ONLY_STATUSES = new Set<string>([CMS_STATUS.UN_ATTENDED, CMS_STATUS.IN_PROGRESS, CMS_STATUS.CUSTOMER_REPLIED, CMS_STATUS.RESOLVED]);

export const getProcessCount = (row: ICms): number => {
  const n = Number(row.processCount);
  return Number.isFinite(n) ? n : 0;
};

export const hasReachedRetryLimit = (row: ICms): boolean => !TEMP_PERMIT && getProcessCount(row) >= MAX_AUTO_CLAIM_ATTEMPTS;

export const getRetryLimitMessage = (row: ICms): string =>
  `Reached limit of retry — ${getProcessCount(row)} attempts (max ${MAX_AUTO_CLAIM_ATTEMPTS})`;

const POB_NON_VALUES = new Set(["undefined", "null", "-", "--", "---", "n/a", "na"]);
export const hasValue = (raw: unknown): boolean => {
  if (raw === null || raw === undefined) return false;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 && !POB_NON_VALUES.has(trimmed.toLowerCase());
};

const platformOf = (row: Pick<ICms, "eCommercePlatform">): string => (row.eCommercePlatform || "").toLowerCase().trim();

export const isMissingRequiredPobId = (row: ICms): boolean => platformOf(row) === "ajio" && !hasValue(row.pobid);
export const isMissingRequiredSubOrder = (row: ICms): boolean => platformOf(row) === "meesho" && !hasValue(row.subOrderNumber);

export const isScriptStatusBlocked = (row: ICms): boolean =>
  row.scriptProcessingStatus === "Running" || (!TEMP_PERMIT && RE_DISPATCH_BLOCKED_STATUSES.includes(row.scriptProcessingStatus ?? ""));

const OTHER_BUNDLE_PLATFORMS = new Set(["flipkart", "delhivery", "xbees", "amazon", "tata cliq", "tatacliq"]);
export const USERNAME_PLATFORMS = new Set(["ajio", "meesho", "snapdeal", "myntra", "nykaa", ...OTHER_BUNDLE_PLATFORMS]);
/** Platforms TrackVid's `isRowSelectable` lets through (Amazon / Tata CliQ rows are never selectable). */
const AUTO_CLAIM_PLATFORMS = new Set(["ajio", "meesho", "snapdeal", "myntra", "flipkart", "delhivery", "xbees", "nykaa"]);

/** Seller-portal account stored on the row, wherever its platform keeps it (Username column). */
export function usernameOf(row: ICms): string {
  const p = platformOf(row);
  if (p === "ajio") return row.ajio_account_email || "";
  if (p === "meesho") return row.meesho_account_email || "";
  if (p === "snapdeal") return row.snapdeal_account_username || "";
  if (p === "myntra") return row.myntraClaimDetails?.username || "";
  if (p === "nykaa") return row.nykaaClaimDetails?.username || "";
  if (OTHER_BUNDLE_PLATFORMS.has(p)) return row.otherClaimDetails?.username || "";
  return "";
}

/** TrackVid `isRowSelectable` (without the global-running gate, which the page adds). */
export function isRowSelectable(row: ICms): boolean {
  if (hasReachedRetryLimit(row)) return false;
  const p = platformOf(row);
  const credentialOk =
    (p === "ajio" && Boolean(row.ajio_account_email) && row.driveStatus !== "pending" && row.driveStatus !== "failed") ||
    (p === "meesho" && Boolean(row.meesho_account_email)) ||
    (p === "snapdeal" && Boolean(row.snapdeal_account_username)) ||
    (p === "myntra" && Boolean(row.myntraClaimDetails?.username)) ||
    ((p === "flipkart" || p === "delhivery" || p === "xbees") && Boolean(row.otherClaimDetails?.username)) ||
    p === "nykaa";
  return credentialOk && row.scriptProcessingStatus !== "Running";
}

/** Why a row's checkbox is disabled (shown as the checkbox tooltip). */
export function selectionDisabledReason(row: ICms): string | undefined {
  if (hasReachedRetryLimit(row)) return getRetryLimitMessage(row);
  if (row.scriptProcessingStatus === "Running") return "Auto claim is running for this claim.";
  if (platformOf(row) === "ajio" && (row.driveStatus === "pending" || row.driveStatus === "failed")) return "Google Drive links are not ready yet.";
  if (!AUTO_CLAIM_PLATFORMS.has(platformOf(row))) return "Auto claim is not available for this platform.";
  if (platformOf(row) !== "nykaa" && !usernameOf(row)) return "Select a seller account (Username) first.";
  return undefined;
}

export interface BundleImageEntry {
  label: string;
  s3Key: string;
}

const keyOf = (img: FileMetadata | string | null | undefined): string => (typeof img === "string" ? img : img?.fileKey || "");

/** Ordered image slots of the platform bundle (Images column → labelled PDF). */
export function collectBundleImages(row: ICms): BundleImageEntry[] {
  const entries: BundleImageEntry[] = [];
  const p = platformOf(row);
  const b = row.otherClaimDetails;
  if (!b) return entries;
  if (p === "amazon") {
    (b.contentsOfReturnImages || []).forEach((img, i) => {
      if (keyOf(img)) entries.push({ label: `contentsOfReturnImages${i + 1}`, s3Key: keyOf(img) });
    });
    if (b.shippingLabelImage?.fileKey) entries.push({ label: "shippingLabelImage", s3Key: b.shippingLabelImage.fileKey });
    if (b.serialNumberImage?.fileKey) entries.push({ label: "serialNumberImage", s3Key: b.serialNumberImage.fileKey });
    return entries;
  }
  if (p === "flipkart" || p === "tata cliq" || p === "tatacliq" || p === "delhivery") {
    if (b.shippingLabelImage?.fileKey) entries.push({ label: "shippingLabelImage", s3Key: b.shippingLabelImage.fileKey });
    (b.packingImages || []).forEach((img, i) => {
      if (keyOf(img)) entries.push({ label: `packingImages${i + 1}`, s3Key: keyOf(img) });
    });
    return entries;
  }
  if (p === "xbees") {
    const labels = ["Top", "Right", "Bottom", "Left"];
    (b.packingImages || []).forEach((img, i) => {
      if (!keyOf(img)) return;
      const side = typeof img === "object" && img?.side ? img.side.charAt(0).toUpperCase() + img.side.slice(1) : labels[i] || `evidence${i + 1}`;
      entries.push({ label: side, s3Key: keyOf(img) });
    });
  }
  return entries;
}

/** Files bundled by "Download All Resources" (same names and order as TrackVid). */
export function collectAllResources(row: ICms): { name: string; key: string }[] {
  const out: { name: string; key: string }[] = [];
  const tail = (v: string) => v.split("/").pop() || v;
  if (row.forwardVideoLink) out.push({ name: "Forward Video Link", key: row.forwardVideoLink });
  (row.additionalFields || []).forEach((f) => out.push({ name: f.key, key: f.value }));
  if (row.returnVideoLink) out.push({ name: "Return Video Link", key: row.returnVideoLink });
  const slots: [string, FileMetadata | null | undefined][] = [
    ["Six Side Images", row.sixSideImages],
    ["Barcode Image", row.barcodeImage],
    ["Received Product Image_1", row.receivedProductImage_1],
    ["Received Product Image 2", row.receivedProductImage_2],
    ["Received Product Image 3", row.receivedProductImage_3],
    ["Reverse WayBill Image", row.reverseWayBillImage],
    ["POD Proof", row.podProof],
    ["Outer Package Image 1", row.outerPackageImage_1],
    ["Outer Package Image 2", row.outerPackageImage_2],
    ["Inner Package Image 1", row.innerPackageImage_1],
    ["Inner Package Image 2", row.innerPackageImage_2],
    ["Product Image 1", row.productImage_1],
    ["Product Image 2", row.productImage_2],
    ["POD Image 1", row.podImage_1],
    ["POD Image 2", row.podImage_2],
    ["Return Product Image", row.returnProductImage],
    ["Forward Sent Product Image", row.forwardSentProductImage],
  ];
  for (const [name, f] of slots) if (f?.fileKey) out.push({ name, key: f.fileKey });
  return out.map((r) => ({ ...r, key: r.key.startsWith("http") || r.key.startsWith("/") ? r.key : tail(r.key) }));
}

const TAT_ALIASES: Record<string, string[]> = {
  xbees: ["expressbees"],
  expressbees: ["xbees"],
  nykaa: ["naykaa", "nykaafashion"],
  "nykaa fashion": ["nykaa", "naykaa", "nykaafashion"],
  nykaafashion: ["nykaa", "naykaa"],
  "tata cliq": ["tatacliq"],
  tatacliq: ["tata cliq"],
};

/** Days left before the SPF claim TAT runs out (Out Of TAT column), or null when no TAT is known. */
export function remainingTatDays(row: ICms, user: IUser | null | undefined, now: number): number | null {
  let tat: number | undefined = typeof row.spfClaimTatPeriod === "number" ? row.spfClaimTatPeriod : undefined;
  if (tat === undefined) {
    const name = platformOf(row);
    const map = user?.company?.settings?.spfClaimTatPeriod ?? {};
    const stripped = name.split(" ").join("");
    const candidates = [name, stripped, ...(TAT_ALIASES[name] ?? []), ...(TAT_ALIASES[stripped] ?? [])];
    for (const key of candidates) {
      const v = map[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        tat = v;
        break;
      }
    }
    if (tat === undefined) {
      const match = user?.company?.settings?.eCommercePlatform?.find((p) => p.name.trim().toLowerCase() === name);
      if (typeof match?.tatPeriod === "number") tat = match.tatPeriod;
    }
  }
  const created = new Date(row.createdAt).getTime();
  if (tat === undefined || !Number.isFinite(created)) return null;
  return tat - Math.floor((now - created) / 86_400_000);
}

/** Status tabs for a platform (AJIO / Myntra / Nykaa add their own lifecycle states). */
export function statusTabsFor(platformTab: string): PlatformTab[] {
  const p = platformTab.toLowerCase().trim();
  const isAjio = p === "ajio";
  const isMyntra = p === "myntra";
  const isNykaa = ["nykaa", "naykaa", "nykaa fashion"].includes(p);
  const tabs: PlatformTab[] = [
    { value: "All", label: "All", dot: "#0088A3" },
    { value: CMS_STATUS.FAILED_TO_PROCEED, label: "Failed to Proceed", dot: "#B91C1C" },
    { value: CMS_STATUS.PENDING, label: "Pending", dot: "#F59E0B" },
    { value: CMS_STATUS.IN_REVIEW, label: "In Review", dot: "#0EA5E9" },
  ];
  if (isAjio) {
    tabs.push(
      { value: CMS_STATUS.UN_ATTENDED, label: "Un Attended", dot: "#A855F7" },
      { value: CMS_STATUS.IN_PROGRESS, label: "In Progress", dot: "#2563EB" },
      { value: CMS_STATUS.CUSTOMER_REPLIED, label: "Customer Replied", dot: "#14B8A6" },
    );
  }
  if (isMyntra) tabs.push({ value: CMS_STATUS.AWAITING_SELLER_RESPONSE, label: "Awaiting Seller Response", dot: "#F97316" });
  if (isNykaa) {
    tabs.push(
      { value: CMS_STATUS.OPEN, label: "Open", dot: "#38BDF8" },
      { value: CMS_STATUS.IN_PROGRESS, label: "In Progress", dot: "#2563EB" },
      { value: CMS_STATUS.ON_HOLD, label: "On Hold", dot: "#A16207" },
      { value: CMS_STATUS.AWAITING_SELLER_RESPONSE, label: "Awaiting Seller Response", dot: "#F97316" },
    );
  }
  tabs.push({ value: CMS_STATUS.APPROVED, label: "Approved", dot: "#22C55E" });
  if (isMyntra) {
    tabs.push(
      { value: CMS_STATUS.AWAITING_AGENT_RESPONSE, label: "Awaiting Agent Response", dot: "#6366F1" },
      { value: CMS_STATUS.PAID, label: "Paid", dot: "#059669" },
    );
  }
  tabs.push({ value: CMS_STATUS.REJECTED, label: "Rejected", dot: "#EF4444" });
  if (isAjio) tabs.push({ value: CMS_STATUS.RESOLVED, label: "Resolved", dot: "#84CC16" });
  if (isNykaa) {
    tabs.push({ value: CMS_STATUS.RESOLVED, label: "Resolved", dot: "#84CC16" }, { value: CMS_STATUS.CLOSED, label: "Closed", dot: "#64748B" });
  }
  return tabs;
}

/** Platform tab a claim's platform belongs to ("Other" for non-named ones). */
export function platformTabOf(platform: string): string {
  const p = platform.toLowerCase().trim();
  const tab = PLATFORM_TABS.find((t) => t.value.toLowerCase() === p || (t.value === "Nykaa" && (p === "nykaa fashion" || p === "naykaa")));
  return tab ? tab.value : OTHER_TAB;
}
