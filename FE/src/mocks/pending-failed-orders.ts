import { seeded } from "@/mocks/delay";
import type { PendingFailedCompany, PendingFailedFeed, PendingFailedOrder } from "@/types/pending-failed-orders";

/** Sample feeds of the signed-in company with orders stuck in import (pending) or rejected (failed). */
const FEEDS: readonly { name: string; pending: number; failed: number; platform: string | null; prefix: string }[] = [
  { name: "Ajio Dropship – Surat WH", pending: 467, failed: 12, platform: "AJIO", prefix: "1490" },
  { name: "Myntra PPMP – Bengaluru", pending: 38, failed: 6, platform: "MYNTRA", prefix: "MYN" },
  { name: "Flipkart Daily Sheet", pending: 21, failed: 0, platform: "FLIPKART", prefix: "FMPP" },
  { name: "Amazon FBA Returns", pending: 0, failed: 9, platform: "AMAZON", prefix: "AMZ" },
  { name: "Meesho Supplier Panel", pending: 14, failed: 3, platform: "MEESHO", prefix: "MSH" },
  { name: "Nykaa Fashion Orders", pending: 5, failed: 1, platform: "NYKAA", prefix: "NYK" },
  { name: "Delhivery Manifest Upload", pending: 3, failed: 2, platform: null, prefix: "DLV" },
  { name: "Snapdeal Weekly Import", pending: 0, failed: 0, platform: "SNAPDEAL", prefix: "SD" },
  { name: "Tata CliQ Luxury", pending: 7, failed: 0, platform: "TATA CLIQ", prefix: "TCL" },
  { name: "Xpressbees RTO Sheet", pending: 2, failed: 4, platform: null, prefix: "XB" },
];

function buildOrders(feedIndex: number, count: number, prefix: string, platform: string | null, status: "p" | "f"): PendingFailedOrder[] {
  const rand = seeded(9000 + feedIndex * 31 + (status === "p" ? 1 : 2));
  return Array.from({ length: count }, (_, i) => {
    const digits = String(Math.floor(rand() * 1e10)).padStart(10, "0");
    return {
      _id: `${status}${feedIndex.toString(16)}${i.toString(16).padStart(6, "0")}`.padEnd(24, "0"),
      AWBNumber: `${prefix}${digits}`,
      orderType: rand() > 0.3 ? "Forward" : "Return",
      // A few rows have no matching order (null) — the screen shows "—".
      eCommercePlatform: rand() > 0.9 ? null : platform,
    };
  });
}

const feeds: PendingFailedFeed[] = FEEDS.map((f, i) => {
  const pending = buildOrders(i, f.pending, f.prefix, f.platform, "p");
  const failed = buildOrders(i, f.failed, f.prefix, f.platform, "f");
  return {
    feedId: `66f1a0c2e4b0${String(100000000000 + i)}`.slice(0, 24),
    feedName: f.name,
    pending_orders: pending,
    failed_orders: failed,
    totalPendingOrders: pending.length,
    totalFailedOrders: failed.length,
  };
});

export const pendingFailedCompany: PendingFailedCompany = {
  companyId: "65a7c3e9f1b2c4d5e6f70811",
  companyName: "Shree Krishna Textiles",
  feeds,
  totalPendingOrders: feeds.reduce((s, f) => s + f.totalPendingOrders, 0),
  totalFailedOrders: feeds.reduce((s, f) => s + f.totalFailedOrders, 0),
};
