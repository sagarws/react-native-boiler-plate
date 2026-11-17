import { CLAIM_HISTORY_ACTION_TYPE } from "@/config/app-constant";
import { CMS_STATUS } from "@/config/constant";
import { daysAgo, seeded } from "@/mocks/delay";
import { samplePlatforms } from "@/mocks/user";
import type { AjioArticle, CredentialSession, FileMetadata, ICms, IClaimHistory, IHistory, ScriptProcessingStatus } from "@/types/cms";

/** Sample SPF claims for Manage SPF Claims (mock of POST /cms). Deterministic so screenshots stay stable. */

const rnd = seeded(20261117);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
const digits = (n: number): string => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join("");

const VIDEO_RETURN = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const VIDEO_FORWARD = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm";
const IMG_A = "/assets/images/products.webp";
const IMG_B = "/assets/images/warehouse.webp";

const BRANDS = ["Urban Threads", "Kurta Kraft", "DenimDaily", "Shree Ethnic", "Bombay Basics"];
const SKUS = ["UT-KRT-BLU-M", "UT-KRT-RED-L", "KK-SAREE-GRN", "DD-JNS-32-BLK", "SE-LEH-PNK-S", "BB-TEE-WHT-XL", "UT-DRS-YLW-M"];
const POBS = ["POB1029", "POB1047", "POB2210"];
const FEEDS = [
  { id: "feed00000000000000000001", name: "Packing Station 1" },
  { id: "feed00000000000000000002", name: "Packing Station 2" },
  { id: "feed00000000000000000003", name: "Return Desk" },
  { id: "feed00000000000000000004", name: "QC Table" },
];
const USERS = [
  { _id: "64f0c0ffee0000000000a001", name: { fullName: "Aarav Mehta" }, email: "aarav@urbanthreads.in" },
  { _id: "64f0c0ffee0000000000a002", name: { fullName: "Priya Shah" }, email: "priya@urbanthreads.in" },
];

/** Platform → how many rows, AWB prefix, and which statuses the platform's tab strip shows. */
const PLATFORM_PLAN: { name: string; count: number; awb: string; statuses: string[] }[] = [
  {
    name: "Ajio",
    count: 34,
    awb: "1490",
    statuses: [CMS_STATUS.PENDING, CMS_STATUS.PENDING, CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.UN_ATTENDED, CMS_STATUS.IN_PROGRESS, CMS_STATUS.CUSTOMER_REPLIED, CMS_STATUS.APPROVED, CMS_STATUS.REJECTED, CMS_STATUS.RESOLVED, CMS_STATUS.FAILED_TO_PROCEED],
  },
  { name: "Meesho", count: 14, awb: "VL", statuses: [CMS_STATUS.PENDING, CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.APPROVED, CMS_STATUS.REJECTED, CMS_STATUS.FAILED_TO_PROCEED] },
  { name: "Snapdeal", count: 9, awb: "SD", statuses: [CMS_STATUS.PENDING, CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.APPROVED, CMS_STATUS.REJECTED] },
  {
    name: "Nykaa",
    count: 10,
    awb: "NYK",
    statuses: [CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.OPEN, CMS_STATUS.IN_PROGRESS, CMS_STATUS.ON_HOLD, CMS_STATUS.AWAITING_SELLER_RESPONSE, CMS_STATUS.APPROVED, CMS_STATUS.RESOLVED, CMS_STATUS.CLOSED],
  },
  { name: "Amazon", count: 9, awb: "AMZ", statuses: [CMS_STATUS.PENDING, CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.APPROVED, CMS_STATUS.REJECTED] },
  {
    name: "Myntra",
    count: 14,
    awb: "MYN",
    statuses: [CMS_STATUS.PENDING, CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.AWAITING_SELLER_RESPONSE, CMS_STATUS.APPROVED, CMS_STATUS.AWAITING_AGENT_RESPONSE, CMS_STATUS.PAID, CMS_STATUS.REJECTED],
  },
  { name: "Flipkart", count: 12, awb: "FMPR", statuses: [CMS_STATUS.PENDING, CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.APPROVED, CMS_STATUS.REJECTED, CMS_STATUS.FAILED_TO_PROCEED] },
  { name: "Tata CliQ", count: 7, awb: "TCQ", statuses: [CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.APPROVED, CMS_STATUS.REJECTED] },
  { name: "Delhivery", count: 7, awb: "2905", statuses: [CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.APPROVED] },
  { name: "Xbees", count: 7, awb: "1420", statuses: [CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.APPROVED, CMS_STATUS.REJECTED] },
  { name: "Shopify", count: 4, awb: "SHP", statuses: [CMS_STATUS.PENDING, CMS_STATUS.IN_REVIEW, CMS_STATUS.APPROVED] },
];

const SCRIPT_ERRORS = [
  "Login failed: seller portal asked for captcha",
  "Help Center form did not load in 30s",
  "Order not found on the seller portal for this AWB",
  "pobid missing in config",
  "Upload rejected: image larger than 5 MB",
];

const file = (key: string, days: number): FileMetadata => ({ fileKey: key, createdAt: daysAgo(days) });

function claimTypesFor(platform: string): string[] {
  const p = samplePlatforms.find((x) => x.name.toLowerCase() === platform.toLowerCase());
  const names = p?.typeOfClaims.filter((c) => !c.isDisable).map((c) => c.name) ?? [];
  return names.length ? names.slice(0, 6) : ["Wrong product received", "Damaged product received", "Product missing"];
}

function emailBody(platform: string, awb: string, claimType: string): string {
  return [
    `<p>Dear ${platform} Seller Support,</p>`,
    `<p>We are raising a Seller Protection Fund claim for return AWB <strong>${awb}</strong>.</p>`,
    `<p><strong>Claim type:</strong> ${claimType}</p>`,
    "<p>The packing and unboxing CCTV footage, the product images and the shipping label are attached below.</p>",
    `<ul><li><a href="${VIDEO_RETURN}">Return unboxing video</a></li><li><a href="${VIDEO_FORWARD}">Forward packing video</a></li></ul>`,
    "<p>Kindly review and approve the claim at the earliest.</p>",
    "<p>Regards,<br>Urban Threads Pvt Ltd</p>",
  ].join("");
}

function usernameFields(platform: string, withUser: boolean): Partial<ICms> {
  const p = platform.toLowerCase();
  if (!withUser) return {};
  if (p === "ajio") return { ajio_account_email: "ops@urbanthreads.in" };
  if (p === "meesho") return { meesho_account_email: "meesho@urbanthreads.in" };
  if (p === "snapdeal") return { snapdeal_account_username: "urbanthreads_sd" };
  if (p === "myntra") return { myntraClaimDetails: { username: "myntra@urbanthreads.in" } };
  if (p === "nykaa") return { nykaaClaimDetails: { username: "nykaa@urbanthreads.in" } };
  if (["flipkart", "delhivery", "xbees", "amazon", "tata cliq"].includes(p)) return { otherClaimDetails: { username: p === "flipkart" ? "fk@urbanthreads.in" : `${p.replace(/\s/g, "")}@urbanthreads.in` } };
  return {};
}

function platformBundle(platform: string, i: number, created: number): Partial<ICms> {
  const p = platform.toLowerCase();
  if (p === "myntra") {
    return {
      myntraClaimDetails: {
        shippingLabelImage: file(IMG_B, created),
        packingImages: [file(IMG_A, created), file(IMG_B, created)],
        damagedProductVideoLink: i % 3 === 0 ? VIDEO_RETURN : undefined,
      },
    };
  }
  if (p === "amazon") {
    return {
      otherClaimDetails: {
        shippingLabelImage: file(IMG_B, created),
        serialNumberImage: i % 2 === 0 ? file(IMG_A, created) : null,
        contentsOfReturnImages: [file(IMG_A, created), file(IMG_B, created)],
        fulfillmentChannel: i % 2 ? "Easy Ship" : "Self Ship",
        parentSelection: "Product related",
      },
    };
  }
  if (p === "flipkart" || p === "tata cliq" || p === "delhivery") {
    return {
      otherClaimDetails: {
        shippingLabelImage: file(IMG_B, created),
        packingImages: i % 4 === 0 ? [] : [file(IMG_A, created), file(IMG_B, created), file(IMG_A, created)],
        claimArea: p === "flipkart" ? "Return" : undefined,
        parentSelection: p === "tata cliq" ? "QC Failed" : undefined,
        domestic: p === "delhivery" ? (i % 2 ? "EXPRESS" : "SURFACE") : undefined,
      },
    };
  }
  if (p === "xbees") {
    return {
      otherClaimDetails: {
        packingImages: [
          { fileKey: IMG_A, side: "top" },
          { fileKey: IMG_B, side: "right" },
          { fileKey: IMG_A, side: "bottom" },
          { fileKey: IMG_B, side: "left" },
        ],
        disputeAmount: String(450 + i * 35),
      },
    };
  }
  if (p === "nykaa") {
    return { nykaaClaimDetails: { vendorCode: `NV${digits(4)}`, skuId: `NYKSKU${digits(5)}`, returnType: pick(["RTO", "DTO", "REPL"] as const) } };
  }
  if (p === "meesho") {
    return {
      packetId: `PKT${digits(8)}`,
      stateOfThePacket: i % 3 === 0 ? 2 : 1,
      barcodeImage: file(IMG_A, created),
      receivedProductImage_1: file(IMG_B, created),
      receivedProductImage_2: file(IMG_A, created),
      reverseWayBillImage: file(IMG_B, created),
    };
  }
  if (p === "snapdeal") {
    return {
      outerPackageImage_1: file(IMG_A, created),
      outerPackageImage_2: file(IMG_B, created),
      innerPackageImage_1: file(IMG_A, created),
      productImage_1: file(IMG_B, created),
      podImage_1: file(IMG_A, created),
    };
  }
  return {
    returnProductImage: file(IMG_A, created),
    forwardSentProductImage: file(IMG_B, created),
    sixSideImages: i % 3 === 2 ? null : { fileKey: `sixside-${i}.pdf`, createdAt: daysAgo(created) },
    podProof: file(IMG_B, created),
  };
}

function scriptStateFor(status: string, i: number): Partial<ICms> {
  if (status === CMS_STATUS.FAILED_TO_PROCEED) {
    return { scriptProcessingStatus: "Not Started", processCount: 3 + (i % 2), scriptProcessingError: i % 3 === 0 ? null : pick(SCRIPT_ERRORS) };
  }
  if (status !== CMS_STATUS.PENDING) return { scriptProcessingStatus: "Success", processCount: 1 + (i % 2), scriptProcessingError: null };
  const states: { s: ScriptProcessingStatus; count: number; err?: boolean }[] = [
    { s: "Not Started", count: 0 },
    { s: "Not Started", count: 0 },
    { s: "Not Started", count: 1 },
    { s: "Failed", count: 1, err: true },
    { s: "Failed", count: 2, err: true },
    { s: "Help Center Failed", count: 1, err: true },
    { s: "Not Started", count: 3 },
    { s: "Not Started", count: 0 },
  ];
  const st = states[i % states.length];
  return { scriptProcessingStatus: st.s, processCount: st.count, scriptProcessingError: st.err ? (st.s === "Help Center Failed" ? SCRIPT_ERRORS[1] : pick(SCRIPT_ERRORS)) : null };
}

function buildClaims(): ICms[] {
  const out: ICms[] = [];
  let serial = 0;
  for (const plan of PLATFORM_PLAN) {
    const claimTypes = claimTypesFor(plan.name);
    for (let i = 0; i < plan.count; i += 1) {
      serial += 1;
      const id = `cms${String(serial).padStart(21, "0")}`;
      const status = plan.statuses[i % plan.statuses.length];
      // Most rows land in the default "last 7 days" window; the rest spread over 6 weeks.
      const created = i % 3 === 2 ? 8 + ((i * 5) % 34) : (i * 2) % 7;
      const awb = `${plan.awb}${digits(plan.awb.length > 3 ? 9 : 10)}`;
      const claimType = claimTypes[i % claimTypes.length];
      const feed = FEEDS[i % FEEDS.length];
      const p = plan.name.toLowerCase();
      const isAjio = p === "ajio";
      const hasTicket = status !== CMS_STATUS.PENDING && status !== CMS_STATUS.FAILED_TO_PROCEED;
      const withUser = !(i % 9 === 4);
      const row: ICms = {
        _id: id,
        eCommercePlatform: plan.name,
        AWBNumber: awb,
        forwardAWB: i % 5 === 3 && (isAjio || p === "meesho") ? "" : `FWD${digits(10)}`,
        subOrderNumber: p === "meesho" || p === "snapdeal" ? (i % 6 === 5 ? "" : `${digits(12)}_1`) : undefined,
        customerOrderNumber: `FN${digits(10)}`,
        seller_sku: i % 7 === 6 ? "" : SKUS[i % SKUS.length],
        pobid: isAjio ? (i % 6 === 4 ? (i % 12 === 4 ? "undefined" : "") : POBS[i % POBS.length]) : undefined,
        ticketNumber: hasTicket ? `${plan.awb.slice(0, 2).toUpperCase()}${digits(8)}` : "",
        typeOfClaim: claimType,
        returnDeliveryDate: daysAgo(created + 2, 15),
        forwardOrderDate: daysAgo(created + 12, 11),
        remark: i % 2 ? "Customer returned a different product in the parcel." : "Outer packet tampered, product missing.",
        status,
        rejectReason: status === CMS_STATUS.REJECTED ? pick(["Video does not show the AWB label clearly", "Claim raised after TAT window", "Product received matches the dispatched SKU"]) : undefined,
        compensationAmount: status === CMS_STATUS.PAID ? 499 + i * 120 : null,
        createdAt: daysAgo(created, 9 + (i % 8)),
        history: `hist${String(serial).padStart(20, "0")}`,
        feedId: feed.id,
        feed: { name: feed.name },
        order_Brand: BRANDS[i % BRANDS.length],
        accountType: isAjio ? (i % 2 ? "Enterprise" : "Seller") : p === "shopify" ? "D2C" : undefined,
        emailTemplate: { _id: id, subject: `SPF Claim - ${plan.name} - AWB ${awb}`, body: emailBody(plan.name, awb, claimType) },
        processingMode: hasTicket ? pick(["automated", "automated", "manual", "desktop"] as const) : undefined,
        driveStatus: isAjio ? (i === 2 ? "pending" : i === 9 ? "failed" : "uploaded") : undefined,
        spfClaimTatPeriod: i % 4 === 0 ? undefined : [7, 10, 15, 30][i % 4],
        returnVideoLink: VIDEO_RETURN,
        forwardVideoLink: i % 4 === 1 ? undefined : VIDEO_FORWARD,
        additionalFields: i % 5 === 0 ? [{ key: "Invoice", value: IMG_B, _id: `${id}-af1` }] : [],
        ...scriptStateFor(status, i),
        ...usernameFields(plan.name, withUser),
      };
      const bundle = platformBundle(plan.name, i, created);
      // Keep the username the bundle-less platforms put in the same envelope.
      if (bundle.otherClaimDetails && row.otherClaimDetails) bundle.otherClaimDetails = { ...bundle.otherClaimDetails, username: row.otherClaimDetails.username };
      if (bundle.myntraClaimDetails && row.myntraClaimDetails) bundle.myntraClaimDetails = { ...bundle.myntraClaimDetails, username: row.myntraClaimDetails.username };
      if (bundle.nykaaClaimDetails && row.nykaaClaimDetails) bundle.nykaaClaimDetails = { ...bundle.nykaaClaimDetails, username: row.nykaaClaimDetails.username };
      out.push({ ...row, ...bundle });
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const sampleClaims: ICms[] = buildClaims();

function historyFor(row: ICms): IClaimHistory {
  const created = new Date(row.createdAt).getTime();
  const at = (h: number) => new Date(created + h * 3_600_000).toISOString();
  const events: IHistory[] = [
    { _id: `${row.history}-1`, action_type: CLAIM_HISTORY_ACTION_TYPE.CMS_CREATED, date: at(0), description: `Claim created for AWB ${row.AWBNumber}`, user: USERS[0] },
  ];
  if (Number(row.history.slice(-1)) % 2 === 0) {
    events.push({ _id: `${row.history}-2`, action_type: CLAIM_HISTORY_ACTION_TYPE.EMAIL_TEMPLATE_UPDATED, date: at(2), description: "Claim email template updated", user: USERS[1] });
  }
  if (row.ticketNumber) {
    events.push({ _id: `${row.history}-3`, action_type: CLAIM_HISTORY_ACTION_TYPE.TICKET_ADDED, date: at(5), description: `Ticket ${row.ticketNumber} added`, user: row.processingMode === "manual" ? USERS[0] : null, feed: row.processingMode === "manual" ? null : { _id: row.feedId ?? "", feedName: row.feed?.name ?? "Automation" } });
    events.push({ _id: `${row.history}-4`, action_type: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_PENDING_TO_IN_REVIEW, date: at(5.1), description: "Status changed from Pending to In Review" });
  }
  if (row.status === CMS_STATUS.APPROVED || row.status === CMS_STATUS.PAID || row.status === CMS_STATUS.RESOLVED) {
    events.push({ _id: `${row.history}-5`, action_type: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_IN_REVIEW_TO_APPROVED, date: at(52), description: "Status changed from In Review to Approved", user: USERS[0] });
  }
  if (row.status === CMS_STATUS.REJECTED) {
    events.push({ _id: `${row.history}-6`, action_type: CLAIM_HISTORY_ACTION_TYPE.STATUS_CHANGED_FROM_IN_REVIEW_TO_REJECTED, date: at(48), description: `Status changed from In Review to Rejected. Reason: ${row.rejectReason ?? "-"}`, user: USERS[1] });
  }
  return { _id: row.history, claimId: row._id, history: events, createdAt: at(0), updatedAt: events[events.length - 1].date };
}

export const sampleClaimHistory: IClaimHistory[] = sampleClaims.map(historyFor);

/** Master-data lines per AWB (mock of `/order/{awb}` records used by Master Sync and the edit modal SKU picker). */
export interface MasterRecord {
  _id: string;
  awb: string;
  forwardAWB: string;
  sku: string;
  pobId: string;
}

export const sampleMasterRecords: MasterRecord[] = sampleClaims.flatMap((row, i): MasterRecord[] => {
  const p = row.eCommercePlatform.toLowerCase();
  if (!["ajio", "meesho", "snapdeal", "flipkart"].includes(p) || i % 5 === 1) return [];
  const base = { awb: row.AWBNumber, forwardAWB: row.forwardAWB || `FWD${String(7_000_000_000 + i)}`, pobId: p === "ajio" ? POBS[i % POBS.length] : "" };
  if (p === "ajio" && i % 4 === 0) {
    // Multi-line return: two SKUs (and on some, two POBs) → operator must choose.
    return [
      { _id: `mr-${i}-a`, ...base, sku: SKUS[i % SKUS.length] },
      { _id: `mr-${i}-b`, ...base, sku: SKUS[(i + 3) % SKUS.length], pobId: i % 8 === 0 ? POBS[(i + 1) % POBS.length] : base.pobId },
    ];
  }
  return [{ _id: `mr-${i}`, ...base, sku: row.seller_sku || SKUS[(i + 1) % SKUS.length] }];
});

/** AJIO articles for the SKU + POB sweep (mock of what AJIO's return APIs answer). */
export function ajioArticlesFor(awb: string, i: number): AjioArticle[] {
  const one = (k: number): AjioArticle => ({
    returnItemId: `${awb}-RI${k}`,
    sku: SKUS[(i + k) % SKUS.length],
    identifiers: [`EAN${String(8_901_000_000_000 + i * 10 + k)}`],
    productName: ["Cotton Kurta", "Denim Jeans", "Silk Saree", "Printed Tee"][(i + k) % 4],
    color: ["Blue", "Red", "Green", "Black"][(i + k) % 4],
    imageUrl: k % 2 ? IMG_B : IMG_A,
    quantity: 1,
  });
  return i % 4 === 0 ? [one(0), one(1)] : [one(0)];
}

/** Seed sessions for the company's seller-portal credentials (Integrations "Session" column). */
export function seedSession(provider: string, index: number): CredentialSession | null {
  if (index % 3 === 2) return null;
  const now = Date.now();
  return {
    savedAt: new Date(now - (index + 1) * 5 * 3_600_000).toISOString(),
    expiresAt: new Date(now + (index % 2 ? -2 : 18) * 3_600_000).toISOString(),
    ip: `103.21.58.${40 + index}`,
    source: "automation",
    cookieNames: ["session", "csrftoken"],
    userId: provider === "ajio" ? `AJS${1000 + index}` : null,
    pobCount: provider === "ajio" ? 3 : undefined,
  };
}

export const AJIO_STORES: Record<string, string> = { POB1029: "Surat Warehouse", POB1047: "Ahmedabad Hub", POB2210: "Mumbai Fulfilment" };
