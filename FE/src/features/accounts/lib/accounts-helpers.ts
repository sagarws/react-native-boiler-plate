import { CREDIT_HISTORY_ACTION_TYPE } from "@/config/app-constant";
import type { BadgeTone } from "@/components/ui/card-primitives";
import { AccountService, GST_RATE } from "@/services/account-service";
import { UserService } from "@/services/user-service";
import type { PaymentMode, PaymentStatus, VideoSizeRate } from "@/types/accounts";
import type { ICompany, IPlan, IUser } from "@/types/common";

export { GST_RATE };

/** TrackVid `CREDIT_HISTORY_ACTION_OPTIONS` (CreditHistory action filter). */
export const CREDIT_HISTORY_ACTION_OPTIONS = [
  { label: "VMS Created", value: 1 },
  { label: "CMS Created", value: 2 },
  { label: "Credit Purchased", value: 3 },
  { label: "Bonus Added", value: 4 },
  { label: "Refund Added", value: 5 },
  { label: "Revoke Credit", value: 6 },
  { label: "Favorite VMS Credit", value: 7 },
  { label: "Validity Extended", value: 8 },
  { label: "Extra Bonus Added", value: 9 },
  { label: "Extra Bonus Revoked", value: 10 },
  { label: "Credit Deducted", value: 11 },
  { label: "CMS Video Uploaded", value: 12 },
] as const;

const CREDIT_ADDED_ACTIONS: readonly number[] = [
  CREDIT_HISTORY_ACTION_TYPE.BONUS_ADDED,
  CREDIT_HISTORY_ACTION_TYPE.CREDIT_PURCHASED,
  CREDIT_HISTORY_ACTION_TYPE.EXTRA_BONUS_ADDED,
];

/** Same rule as TrackVid `isCreditDeducted`. */
export const isCreditDeducted = (actionType: number): boolean => !CREDIT_ADDED_ACTIONS.includes(actionType);

export const actionTone = (actionType: number): BadgeTone => (CREDIT_ADDED_ACTIONS.includes(actionType) ? "success" : "neutral");

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = { upi: "UPI", bank: "Bank transfer", online: "Online" };

export const paymentStatusLabel = (s: PaymentStatus): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Credit plan tiers in price order (TrackVid `TIER_META`). */
export const TIER_META = [
  { label: "Starter", icon: "lightning", tone: "neutral" },
  { label: "Growth", icon: "chart-line-up", tone: "blue" },
  { label: "Scale", icon: "sparkle", tone: "coral" },
  { label: "Enterprise", icon: "crown", tone: "amber" },
] as const;

export const QUARTER_LABEL: Record<number, string> = { 1: "Q1 • Jan–Mar", 2: "Q2 • Apr–Jun", 3: "Q3 • Jul–Sep", 4: "Q4 • Oct–Dec" };

/** TrackVid `getCurrentQuarterOptions`: Q4 2024 → current quarter. */
export function quarterOptions(now = new Date()): { value: string; label: string }[] {
  const names: Record<number, [string, string]> = { 1: ["January", "March"], 2: ["April", "June"], 3: ["July", "September"], 4: ["October", "December"] };
  const currentYear = now.getFullYear();
  const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);
  const out: { value: string; label: string }[] = [];
  for (let year = 2024; year <= currentYear; year += 1) {
    const startQ = year === 2024 ? 4 : 1;
    const endQ = year === currentYear ? currentQuarter : 4;
    for (let quarter = startQ; quarter <= endQ; quarter += 1) {
      const [a, b] = names[quarter];
      out.push({ value: JSON.stringify({ quarter, year }), label: `Q${quarter} • ${a}–${b} ${year}` });
    }
  }
  return out;
}

/** TrackVid `utils/credit-finder.ts`: credits for the smallest video-size bucket that fits. */
export function creditFinder(videoSize: number, videoSizeRates: readonly VideoSizeRate[]): number | null {
  const match = videoSizeRates.filter((e) => e.videoSize >= videoSize).sort((a, b) => a.videoSize - b.videoSize)[0];
  return match ? match.credits : null;
}

export function planTotals(plan: IPlan): { total: number; perCredit: string; bonusPct: number; gst: number; payable: number } {
  const credit = plan.credit ?? 0;
  const bonus = plan.bonus ?? 0;
  const total = credit + bonus;
  const gst = (plan.price * GST_RATE) / 100;
  return {
    total,
    perCredit: total > 0 ? (plan.price / total).toFixed(2) : "0",
    bonusPct: credit > 0 ? Math.round((bonus / credit) * 100) : 0,
    gst,
    payable: plan.price + gst,
  };
}

/** Plan the company is on: same id, or same name + type (sample profile ids differ from plan ids). */
export function isCurrentPlan(plan: IPlan, current: IPlan | undefined): boolean {
  if (!current) return false;
  return plan._id === current._id || (plan.name === current.name && plan.type === current.type);
}

/**
 * Re-read the mock wallet and return the profile with fresh `company.creditId` (and plan) so the
 * topbar wallet updates. Also saves it in the mock UserService so a profile reload keeps it.
 */
export async function refreshWallet(user: IUser, patch: Partial<Pick<ICompany, "creditPlan" | "storagePlan">> = {}): Promise<IUser> {
  const usage = await AccountService.getAccountUsage();
  const company: ICompany = {
    ...user.company,
    ...patch,
    creditId: {
      ...user.company.creditId,
      totalCredit: usage.credit.total,
      usedCredit: usage.credit.used,
      remainingCredit: usage.credit.remaining,
      totalStorage: usage.storage.total,
      usedStorage: usage.storage.used,
      remainingStorage: usage.storage.remaining,
    },
  };
  try {
    await UserService.updateUser({ company }, user._id);
  } catch {
    // The store copy is what the screens read; the mock user record is a best-effort mirror.
  }
  return { ...user, company };
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

/** A generated receipt image (data URI) shown for sample records that have no uploaded file. */
export function receiptDataUri(title: string, lines: readonly string[]): string {
  const rows = lines
    .map((l, i) => `<text x="32" y="${132 + i * 30}" font-size="16" fill="#696b61">${escapeXml(l)}</text>`)
    .join("");
  const height = 170 + lines.length * 30;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="${height}" viewBox="0 0 520 ${height}"><rect width="520" height="${height}" rx="18" fill="#fffdf6" stroke="#e4dece"/><rect x="0" y="0" width="520" height="70" rx="18" fill="#fff0c6"/><text x="32" y="44" font-family="sans-serif" font-size="20" font-weight="700" fill="#49340b">${escapeXml(title)}</text><text x="32" y="100" font-family="sans-serif" font-size="13" fill="#8a7d67">Sample file (generated preview)</text><g font-family="sans-serif">${rows}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
