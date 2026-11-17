import { seeded } from "@/mocks/delay";

/**
 * Day-by-day sample data for the Master Dashboard, from the TrackVid "All Time" start (25 Oct 2024)
 * to today. The service sums the days inside the requested range, so every preset and custom
 * range gives consistent numbers and the insight cards get a real previous-period delta.
 */

export interface DailyOrderStats {
  day: string;
  shipped: number;
  returnCreated: number;
  good: number;
  bad: number;
  approved: number;
  rejected: number;
  delivered: number;
}

export interface DailyPlatformStats {
  day: string;
  name: string;
  pending: number;
  inReview: number;
  approved: number;
  rejected: number;
  /** Claims in statuses the dashboard does not break out (draft, closed, …). */
  other: number;
  automated: number;
  forward: number;
  returned: number;
}

export interface DailyCarrierStats {
  day: string;
  carrier: string;
  deliveries: number;
  totalDays: number;
  good: number;
  bad: number;
}

export const ALL_TIME_START = new Date(2024, 9, 25);

/** CMS marketplaces (claims) with a relative volume weight. */
export const CMS_PLATFORMS: readonly { name: string; weight: number; recordings: number }[] = [
  { name: "AJIO", weight: 1, recordings: 1 },
  { name: "MYNTRA", weight: 0.8, recordings: 0.9 },
  { name: "FLIPKART", weight: 0.65, recordings: 0.8 },
  { name: "AMAZON", weight: 0.55, recordings: 0.7 },
  { name: "MEESHO", weight: 0.4, recordings: 0.5 },
  { name: "NYKAA", weight: 0.18, recordings: 0.2 },
  { name: "TATA CLIQ", weight: 0.06, recordings: 0.05 },
];

/** Marketplaces that only have packing recordings (no CMS claims) — merged into the table like TrackVid. */
export const RECORDING_ONLY_PLATFORMS: readonly { name: string; recordings: number }[] = [{ name: "SNAPDEAL", recordings: 0.25 }];

export const CARRIERS: readonly { name: string; speed: number; quality: number }[] = [
  { name: "Delhivery", speed: 3.4, quality: 0.86 },
  { name: "Xpressbees", speed: 4.1, quality: 0.82 },
  { name: "Ekart", speed: 3.1, quality: 0.88 },
  { name: "Shadowfax", speed: 2.6, quality: 0.79 },
  { name: "Blue Dart", speed: 2.2, quality: 0.92 },
  { name: "Ecom Express", speed: 4.6, quality: 0.76 },
  { name: "DTDC", speed: 5.2, quality: 0.74 },
];

export function dayKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildDays(): string[] {
  const days: string[] = [];
  const cursor = new Date(ALL_TIME_START);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  while (cursor <= today) {
    days.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function build() {
  const rand = seeded(20241025);
  const int = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const days = buildDays();
  const orders: DailyOrderStats[] = [];
  const platforms: DailyPlatformStats[] = [];
  const carriers: DailyCarrierStats[] = [];

  days.forEach((day, i) => {
    // Volume grows over time and dips at weekends, like a growing seller.
    const growth = 0.45 + (i / Math.max(days.length, 1)) * 0.9;
    const weekday = new Date(`${day}T12:00:00`).getDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.7 : 1;
    const scale = growth * weekend;

    const shipped = Math.round(int(70, 150) * scale);
    const returnCreated = Math.round(shipped * (0.14 + rand() * 0.12));
    const received = Math.round(returnCreated * (0.7 + rand() * 0.25));
    const bad = Math.round(received * (0.08 + rand() * 0.14));
    const disputes = Math.round(bad * (0.6 + rand() * 0.6));
    const approved = Math.round(disputes * (0.55 + rand() * 0.3));
    orders.push({
      day,
      shipped,
      returnCreated,
      good: received - bad,
      bad,
      approved,
      rejected: disputes - approved,
      delivered: Math.round(shipped * (0.78 + rand() * 0.15)),
    });

    for (const p of CMS_PLATFORMS) {
      const claims = Math.round(int(0, 9) * p.weight * scale);
      const approvedClaims = Math.round(claims * (0.35 + rand() * 0.3));
      const rejectedClaims = Math.round(claims * (0.05 + rand() * 0.1));
      const inReview = Math.round(claims * (0.1 + rand() * 0.15));
      const pending = Math.max(0, Math.round(claims * (0.08 + rand() * 0.12)));
      const other = Math.max(0, claims - approvedClaims - rejectedClaims - inReview - pending);
      platforms.push({
        day,
        name: p.name,
        pending,
        inReview,
        approved: approvedClaims,
        rejected: rejectedClaims,
        other,
        automated: Math.round(approvedClaims * (0.6 + rand() * 0.3)),
        forward: Math.round(int(10, 40) * p.recordings * scale),
        returned: Math.round(int(2, 12) * p.recordings * scale),
      });
    }
    for (const p of RECORDING_ONLY_PLATFORMS) {
      platforms.push({
        day,
        name: p.name,
        pending: 0,
        inReview: 0,
        approved: 0,
        rejected: 0,
        other: 0,
        automated: 0,
        forward: Math.round(int(4, 18) * p.recordings * scale),
        returned: Math.round(int(0, 6) * p.recordings * scale),
      });
    }

    for (const c of CARRIERS) {
      const deliveries = Math.round(int(4, 22) * scale);
      const returns = Math.round(deliveries * (0.15 + rand() * 0.15));
      const good = Math.round(returns * (c.quality + (rand() - 0.5) * 0.08));
      carriers.push({
        day,
        carrier: c.name,
        deliveries,
        totalDays: deliveries * (c.speed + (rand() - 0.5) * 0.8),
        good,
        bad: Math.max(0, returns - good),
      });
    }
  });

  return { orders, platforms, carriers };
}

/** Built once per page session. */
export const dashboardDb = build();
