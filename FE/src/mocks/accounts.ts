import { daysAgo, seeded } from "@/mocks/delay";
import { sampleUser } from "@/mocks/user";
import type { IPlan } from "@/types/common";
import type {
  BillingProfile,
  DailyData,
  HistoryItem,
  IOrder,
  ITds,
  PaymentMode,
  PaymentRequests,
  PaymentStatus,
} from "@/types/accounts";

/**
 * Sample data for the Accounts, System Admin and order services. `accountsDb` is the mock
 * "database" shared by account-, credit-, creditHistory-, manualPayment-, tds- and order-service
 * (one purchase touches the wallet, the payment list and the credit history at the same time).
 */

export const COMPANY_ID = sampleUser.companyId;
export const COMPANY_NAME = sampleUser.company.name;

/** Same ids / values as the plans in `user-service.ts` (UserService.getPlans). */
export const samplePlans: IPlan[] = (
  [
    ["Starter", "CREDIT", 999, 1000, 0, 0],
    ["Growth", "CREDIT", 4999, 5000, 250, 0],
    ["Scale", "CREDIT", 9999, 11000, 1000, 0],
    ["Enterprise", "CREDIT", 24999, 30000, 5000, 0],
    ["Storage 50 GB", "STORAGE", 799, 0, 0, 50],
    ["Storage 100 GB", "STORAGE", 1499, 0, 0, 100],
    ["Storage 500 GB", "STORAGE", 5999, 0, 0, 500],
  ] as const
).map(([name, type, price, credit, bonus, storage], i) => ({
  _id: `plan${String(i + 1).padStart(20, "0")}`,
  name,
  type,
  price,
  credit: type === "CREDIT" ? credit : undefined,
  storage: type === "STORAGE" ? storage : undefined,
  bonus: bonus || undefined,
  isActive: true,
  isDeleted: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
}));

const creditPlan = (name: string): IPlan => samplePlans.find((p) => p.name === name) ?? samplePlans[0];

export const FEED_NAMES = [
  { _id: `feed${String(1).padStart(20, "0")}`, feedName: "Packing Station 1", cameraType: "Dispatch" },
  { _id: `feed${String(2).padStart(20, "0")}`, feedName: "Packing Station 2", cameraType: "Dispatch" },
  { _id: `feed${String(3).padStart(20, "0")}`, feedName: "Return Desk", cameraType: "Return" },
  { _id: `feed${String(4).padStart(20, "0")}`, feedName: "QC Table", cameraType: "Return" },
] as const;

const PLATFORMS = ["Ajio", "Myntra", "Flipkart", "Amazon", "Meesho", "Snapdeal", "Nykaa", "Tata CliQ"] as const;

/* ---------------- billing profiles used in seeded payments ---------------- */

const ownBilling: BillingProfile = {
  _id: "bill00000000000000000001",
  billing_name: "Urban Threads Pvt Ltd",
  billing_email: "accounts@urbanthreads.in",
  billing_phone: "9876543210",
  gst_number: "24ABCDE1234F1Z5",
  city: "Surat",
  state: "Gujarat",
  country: "India",
  pincode: "395002",
  address_line_1: "Plot 14, Textile Market",
  address_line_2: "Ring Road",
  user_id: sampleUser._id,
  is_disabled: false,
  is_deleted: false,
};

const otherCompanies = [
  ["ops@kurtakart.in", "KurtaKart Retail LLP", "27AAKCK4521H1Z2", "Mumbai", "Maharashtra"],
  ["finance@bagbazaar.co", "BagBazaar Pvt Ltd", "07AAHCB7788K1Z9", "New Delhi", "Delhi"],
  ["admin@shoesquare.in", "ShoeSquare India", "29AAQFS1290M1Z1", "Bengaluru", "Karnataka"],
  ["accounts@glowbeauty.in", "Glow Beauty Co", "33AAFCG3344L1Z7", "Chennai", "Tamil Nadu"],
] as const;

/* ---------------- payments (manual requests + online purchases) ---------------- */

function payment(
  i: number,
  email: string,
  userId: string,
  billing: BillingProfile,
  planName: string,
  status: PaymentStatus,
  mode: PaymentMode,
  days: number,
): PaymentRequests {
  return {
    _id: `pay${String(i).padStart(21, "0")}`,
    user_id: { _id: userId, email },
    user_email: email,
    reference_id: `REF17${String(30000000000 + i * 7919417).slice(0, 11)}`,
    payment_proof: mode === "online" ? "" : `payment-proof/ref-${i}.png`,
    payment_status: status,
    payment_date: daysAgo(days, 11 + (i % 6)),
    payment_mode: mode,
    billing_profile_id: billing,
    plan_id: creditPlan(planName),
  };
}

function seedPayments(): PaymentRequests[] {
  const own = (i: number, plan: string, status: PaymentStatus, mode: PaymentMode, days: number) =>
    payment(i, sampleUser.email, sampleUser._id, ownBilling, plan, status, mode, days);
  const other = (i: number, c: number, plan: string, status: PaymentStatus, days: number) => {
    const [email, name, gst, city, state] = otherCompanies[c];
    const billing: BillingProfile = {
      ...ownBilling,
      _id: `bill${String(10 + c).padStart(20, "0")}`,
      billing_name: name,
      billing_email: email,
      gst_number: gst,
      city,
      state,
      user_id: `user${String(c + 2).padStart(20, "0")}`,
      address_line_1: `${12 + c * 9}, Commerce House`,
    };
    return payment(i, email, billing.user_id, billing, plan, status, c % 2 ? "bank" : "upi", days);
  };
  return [
    other(1, 0, "Scale", "pending", 0),
    other(2, 1, "Growth", "pending", 1),
    own(3, "Starter", "pending", "upi", 2),
    other(4, 2, "Enterprise", "approved", 4),
    own(5, "Growth", "approved", "upi", 9),
    other(6, 3, "Starter", "revoked", 12),
    own(7, "Growth", "approved", "online", 38),
    other(8, 0, "Growth", "approved", 41),
    own(9, "Starter", "failed", "online", 52),
    other(10, 1, "Scale", "approved", 63),
    own(11, "Scale", "approved", "bank", 96),
    other(12, 2, "Starter", "revoked", 120),
    own(13, "Starter", "revoked", "upi", 151),
    own(14, "Growth", "approved", "upi", 210),
    other(15, 3, "Growth", "approved", 240),
    own(16, "Starter", "approved", "online", 300),
  ];
}

/* ---------------- credit history ---------------- */

function awb(rand: () => number, platform: string): string {
  const n = Math.floor(rand() * 9e11 + 1e11);
  if (platform === "Ajio") return `SF${n}AJI`;
  if (platform === "Myntra") return `MYEP${String(n).slice(0, 10)}`;
  if (platform === "Flipkart") return `FMPP${String(n).slice(0, 10)}`;
  if (platform === "Amazon") return `${String(n).slice(0, 12)}`;
  return `1490${String(n).slice(0, 10)}`;
}

function seedCreditHistory(payments: readonly PaymentRequests[]): HistoryItem[] {
  const rand = seeded(4242);
  const rows: HistoryItem[] = [];
  let n = 0;
  const base = (credit: number, actionType: number, createdAt: string): HistoryItem => {
    n += 1;
    return {
      _id: `chis${String(n).padStart(20, "0")}`,
      feedId: null,
      actionType,
      companyId: COMPANY_ID,
      credit,
      orderId: null,
      cmsId: null,
      paymentId: null,
      createdAt,
      companyData: { name: COMPANY_NAME },
    };
  };

  for (let day = 0; day < 200; day += 1) {
    const perDay = 2 + Math.floor(rand() * 5);
    for (let k = 0; k < perDay; k += 1) {
      const createdAt = daysAgo(day, 9 + Math.floor(rand() * 10));
      const r = rand();
      const platform = PLATFORMS[Math.floor(rand() * PLATFORMS.length)];
      if (r < 0.45) {
        const feed = FEED_NAMES[Math.floor(rand() * FEED_NAMES.length)];
        const orderType = feed.cameraType === "Return" ? "Return" : "Forward";
        rows.push({
          ...base(1, 1, createdAt),
          feedId: feed._id,
          orderId: `ord${String(n).padStart(21, "0")}`,
          feedData: { feedName: feed.feedName },
          orderData: { orderType, trackingId: awb(rand, platform) },
        });
      } else if (r < 0.8) {
        rows.push({ ...base(2, 2, createdAt), cmsId: `cms${String(n).padStart(21, "0")}`, cmsData: { AWBNumber: awb(rand, platform) } });
      } else if (r < 0.9) {
        rows.push({ ...base(1, 12, createdAt), cmsId: `cms${String(n).padStart(21, "0")}`, cmsData: { AWBNumber: awb(rand, platform) } });
      } else if (r < 0.95) {
        const feed = FEED_NAMES[Math.floor(rand() * FEED_NAMES.length)];
        rows.push({
          ...base(1, 7, createdAt),
          feedId: feed._id,
          feedData: { feedName: feed.feedName },
          orderData: { orderType: "Forward", trackingId: awb(rand, platform) },
        });
      } else if (r < 0.98) {
        rows.push({ ...base(1, 5, createdAt), cmsData: { AWBNumber: awb(rand, platform) } });
      } else {
        rows.push(base(0, 8, createdAt));
      }
    }
  }

  for (const p of payments) {
    if (p.user_id._id !== sampleUser._id || p.payment_status !== "approved") continue;
    const paymentData = { user_email: p.user_email, payment_status: p.payment_status };
    rows.push({ ...base(p.plan_id.credit ?? 0, 3, p.payment_date), paymentId: p._id, paymentData });
    if (p.plan_id.bonus) rows.push({ ...base(p.plan_id.bonus, 4, p.payment_date), paymentId: p._id, paymentData });
  }
  const revoked = payments.find((p) => p.user_id._id === sampleUser._id && p.payment_status === "revoked");
  if (revoked) rows.push({ ...base(revoked.plan_id.credit ?? 0, 6, revoked.payment_date), paymentId: revoked._id });
  rows.push({ ...base(500, 9, daysAgo(75)) }, { ...base(200, 10, daysAgo(70)) }, { ...base(40, 11, daysAgo(33)) });

  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ---------------- daily usage (usage history tree) ---------------- */

function isoDay(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function seedDailyUsage(): DailyData[] {
  const rand = seeded(9001);
  const out: DailyData[] = [];
  for (let day = 0; day < 420; day += 1) {
    const weekend = new Date(isoDay(day)).getDay() === 0;
    const scale = weekend ? 0.3 : 1;
    const cms = Math.round(rand() * 22 * scale);
    const forward = Math.round((40 + rand() * 120) * scale);
    const ret = Math.round((8 + rand() * 40) * scale);
    const ndr = Math.round(rand() * 4 * scale);
    const reopen = Math.round(rand() * 3 * scale);
    const credits = cms * 2 + forward + ret;
    const rate = 0.92 + rand() * 0.06;
    out.push({
      date: isoDay(day),
      cms_orders: cms,
      cms_orders_credits: cms * 2,
      ndr_ddr_claims: ndr,
      reopen_claims: reopen,
      forward_orders: forward,
      forward_orders_credits: forward,
      return_orders: ret,
      return_orders_credits: ret,
      total_orders: cms + forward + ret,
      total_orders_credits: credits,
      effective_var: Number(rate.toFixed(3)),
      old_effective_var: 1,
      total_effective_amount: Number((credits * rate).toFixed(2)),
    });
  }
  return out;
}

/* ---------------- TDS ---------------- */

function seedTds(): ITds[] {
  const rows: [number, number, number, "1" | "2", number][] = [
    [3, 2026, 18450, "1", 6],
    [2, 2026, 12210, "1", 40],
    [1, 2026, 9875, "2", 120],
    [4, 2025, 15600, "2", 190],
    [3, 2025, 11040, "2", 260],
    [4, 2024, 6320, "2", 330],
  ];
  return rows.map(([quarter, year, amount, status, days], i) => ({
    _id: `tds${String(i + 1).padStart(21, "0")}`,
    companyName: "Urban Threads Pvt Ltd",
    tanNumber: "SRTU04512C",
    panNumber: "AACCU4512K",
    duration: { quarter, year },
    tdsAmount: amount,
    accountNumber: "50200048217736",
    accountHolderName: "Urban Threads Pvt Ltd",
    ifsc: "HDFC0001708",
    status,
    certificateName: `Form16A_Q${quarter}_${year}.pdf`,
    tdsRefundedAmount: status === "2" ? amount : undefined,
    attachment: status === "2" ? `tds-refund/utr-${i + 1}.png` : undefined,
    createdAt: daysAgo(days),
    closedAt: status === "2" ? daysAgo(days - 18) : undefined,
  }));
}

/* ---------------- orders (VMS videos) ---------------- */

const SAMPLE_VIDEOS = [
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
] as const;

function seedOrders(): IOrder[] {
  const rand = seeded(777);
  return Array.from({ length: 64 }, (_, i) => {
    const feed = FEED_NAMES[i % FEED_NAMES.length];
    const platform = PLATFORMS[Math.floor(rand() * PLATFORMS.length)];
    const createdAt = daysAgo(Math.floor(i / 3), 9 + (i % 9));
    const orderType = feed.cameraType === "Return" ? "Return" : "Forward";
    return {
      _id: `ord${String(i + 1).padStart(21, "0")}`,
      fileId: `file${String(i + 1).padStart(20, "0")}`,
      orderType,
      trackingId: awb(rand, platform),
      feedId: feed._id,
      companyId: COMPANY_ID,
      userId: sampleUser._id,
      isDeleted: false,
      deleteOn: null,
      isFavorite: i % 7 === 0,
      createdAt,
      updatedAt: createdAt,
      start_time: createdAt,
      videoLength: 18 + Math.floor(rand() * 70),
      mimetype: "video/mp4",
      size: Math.floor((4 + rand() * 30) * 1024 * 1024),
      feedName: feed.feedName,
      cameraType: feed.cameraType,
      key: SAMPLE_VIDEOS[i % SAMPLE_VIDEOS.length],
      eCommercePlatform: platform,
      cloudStatus: "completed",
      rtspURL: null,
      comment: i % 5 === 0 ? "Seal intact, packed with bubble wrap." : "",
      screenshots: [],
    } satisfies IOrder;
  });
}

/* ---------------- the shared mock database ---------------- */

const seededPayments = seedPayments();

export const accountsDb = {
  wallet: {
    totalCredit: sampleUser.company.creditId.totalCredit,
    usedCredit: sampleUser.company.creditId.usedCredit,
    totalStorage: sampleUser.company.creditId.totalStorage,
    usedStorage: sampleUser.company.creditId.usedStorage,
  },
  payments: seededPayments,
  creditHistory: seedCreditHistory(seededPayments),
  dailyUsage: seedDailyUsage(),
  tds: seedTds(),
  orders: seedOrders(),
  /** Files uploaded in this session, keyed by record id (payment proof / TDS certificate). */
  proofFiles: new Map<string, File>(),
  certificateFiles: new Map<string, File>(),
};

/** Next history id (session records). */
let historyCounter = 90000;
export function nextHistoryId(): string {
  historyCounter += 1;
  return `chis${String(historyCounter).padStart(20, "0")}`;
}

/** Push credit history rows for an approved / purchased payment of the signed-in company. */
export function recordPurchaseCredits(p: PaymentRequests): number {
  const credit = p.plan_id.credit ?? 0;
  const bonus = p.plan_id.bonus ?? 0;
  const now = new Date().toISOString();
  const paymentData = { user_email: p.user_email, payment_status: p.payment_status };
  const base = { feedId: null, companyId: COMPANY_ID, orderId: null, cmsId: null, paymentId: p._id, createdAt: now, companyData: { name: COMPANY_NAME }, paymentData };
  accountsDb.creditHistory = [
    ...(bonus ? [{ ...base, _id: nextHistoryId(), actionType: 4, credit: bonus }] : []),
    { ...base, _id: nextHistoryId(), actionType: 3, credit },
    ...accountsDb.creditHistory,
  ];
  accountsDb.wallet.totalCredit += credit + bonus;
  return credit + bonus;
}

/** Local calendar day (`yyyy-MM-dd`) of an ISO timestamp, for date-range filters. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
