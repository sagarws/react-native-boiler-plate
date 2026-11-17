import { accountsDb, recordPurchaseCredits } from "@/mocks/accounts";
import { clone, delay, newId } from "@/mocks/delay";
import { sampleUser } from "@/mocks/user";
import { UserService } from "@/services/user-service";
import type {
  DailyData,
  IInvoice,
  IPurchasePlanPayload,
  IPurchasePlanResponse,
  ITransaction,
  IUsage,
  MonthlyData,
  OrderUsage,
  PaymentRequests,
} from "@/types/accounts";
import type { IPlan } from "@/types/common";

/** Mock of TrackVid-FE `api/account-service.ts` (+ `purchasePlan`, which replaces the Razorpay checkout). */

export const GST_RATE = 18;

const getAccountUsage = async (): Promise<IUsage> => {
  await delay(300);
  const w = accountsDb.wallet;
  return {
    credit: { total: w.totalCredit, used: w.usedCredit, remaining: Math.max(w.totalCredit - w.usedCredit, 0) },
    storage: {
      total: w.totalStorage,
      used: w.usedStorage,
      remaining: Number(Math.max(w.totalStorage - w.usedStorage, 0).toFixed(1)),
    },
  };
};

const getPlans = async (): Promise<IPlan[]> => UserService.getPlans();

const ownApproved = (): PaymentRequests[] =>
  accountsDb.payments.filter((p) => p.user_id._id === sampleUser._id && p.payment_status === "approved");

const getInvoices = async (): Promise<IInvoice[]> => {
  await delay();
  return ownApproved().map((p, i) => {
    const amount = p.plan_id.price;
    const gstAmount = Number(((amount * GST_RATE) / 100).toFixed(2));
    return {
      _id: `inv${p._id.slice(3)}`,
      invoiceNumber: `TV/${new Date(p.payment_date).getFullYear()}/${String(i + 1).padStart(4, "0")}`,
      paymentId: p._id,
      planName: p.plan_id.name,
      amount,
      gstAmount,
      totalAmount: amount + gstAmount,
      createdAt: p.payment_date,
    };
  });
};

const getTransactions = async (): Promise<ITransaction[]> => {
  await delay();
  return accountsDb.creditHistory.slice(0, 50).map((h) => ({
    _id: h._id,
    type: [3, 4, 9].includes(h.actionType) ? "credit" : "debit",
    description: h.cmsData?.AWBNumber ?? h.orderData?.trackingId ?? h.paymentData?.user_email ?? "",
    credit: h.credit,
    createdAt: h.createdAt,
  }));
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Counters = Omit<DailyData, "date" | "effective_var" | "old_effective_var">;

function emptyCounters(): Counters {
  return {
    cms_orders: 0,
    cms_orders_credits: 0,
    ndr_ddr_claims: 0,
    reopen_claims: 0,
    forward_orders: 0,
    forward_orders_credits: 0,
    return_orders: 0,
    return_orders_credits: 0,
    total_effective_amount: 0,
    total_orders: 0,
    total_orders_credits: 0,
  };
}

function addCounters(into: Counters, d: Counters): void {
  into.cms_orders += d.cms_orders;
  into.cms_orders_credits += d.cms_orders_credits;
  into.ndr_ddr_claims = (into.ndr_ddr_claims ?? 0) + (d.ndr_ddr_claims ?? 0);
  into.reopen_claims = (into.reopen_claims ?? 0) + (d.reopen_claims ?? 0);
  into.forward_orders += d.forward_orders;
  into.forward_orders_credits += d.forward_orders_credits;
  into.return_orders += d.return_orders;
  into.return_orders_credits += d.return_orders_credits;
  into.total_effective_amount = Number((into.total_effective_amount + d.total_effective_amount).toFixed(2));
  into.total_orders += d.total_orders;
  into.total_orders_credits += d.total_orders_credits;
}

/** Year → month → day tree, newest first (shape of TrackVid `/order/order-history`). */
function buildUsageTree(days: readonly DailyData[]): OrderUsage[] {
  const years = new Map<number, OrderUsage>();
  for (const d of days) {
    const [y, m] = d.date.split("-").map(Number);
    let year = years.get(y);
    if (!year) {
      year = { year: y, monthly: [], ...emptyCounters() };
      years.set(y, year);
    }
    let month: MonthlyData | undefined = year.monthly.find((x) => x.month === m);
    if (!month) {
      month = { month: m, monthName: `${MONTHS[m - 1]} ${y}`, daily: [], ...emptyCounters() };
      year.monthly.push(month);
    }
    month.daily.push(d);
    addCounters(month, d);
    addCounters(year, d);
  }
  return [...years.values()]
    .sort((a, b) => b.year - a.year)
    .map((y) => ({ ...y, monthly: y.monthly.sort((a, b) => b.month - a.month) }));
}

const getUsageHistory = async (): Promise<OrderUsage[]> => {
  await delay(450);
  return clone(buildUsageTree(accountsDb.dailyUsage));
};

/**
 * Simulated online checkout (stands in for Razorpay): records an online payment and, when it
 * succeeds, adds plan + bonus credits to the wallet straight away.
 */
const purchasePlan = async (payload: IPurchasePlanPayload): Promise<IPurchasePlanResponse> => {
  await delay(1200);
  const plans = await UserService.getPlans();
  const plan = plans.find((p) => p._id === payload.plan_id);
  if (!plan) throw new Error("Invalid Plan");
  const billing = (await UserService.getBillingProfiles()).find((b) => b._id === payload.billing_profile_id) ?? null;
  const payment: PaymentRequests = {
    _id: newId(),
    user_id: { _id: sampleUser._id, email: sampleUser.email },
    user_email: sampleUser.email,
    reference_id: `pay_${Date.now().toString(36).toUpperCase()}`,
    payment_proof: "",
    payment_status: payload.simulateFailure ? "failed" : "approved",
    payment_date: new Date().toISOString(),
    payment_mode: "online",
    billing_profile_id: billing,
    plan_id: plan,
  };
  accountsDb.payments = [payment, ...accountsDb.payments];
  if (payload.simulateFailure) {
    throw new Error("Payment failed: the bank declined this transaction. No money was taken.");
  }
  const creditAdded = recordPurchaseCredits(payment);
  return { message: "Payment successful. Credits added to your wallet.", payment: clone(payment), creditAdded };
};

export const AccountService = {
  getAccountUsage,
  getPlans,
  getInvoices,
  getTransactions,
  getUsageHistory,
  purchasePlan,
};
