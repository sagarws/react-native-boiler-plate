"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { PageHeading } from "@/components/ui/page-heading";
import { EmptyState } from "@/components/ui/states";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { CreditHistory } from "@/features/accounts/components/credit-history";
import { MyUsage } from "@/features/accounts/components/my-usage";
import { Plans } from "@/features/accounts/components/plans";
import { PurchaseHistory } from "@/features/accounts/components/purchase-history";
import { TdsReimbursement } from "@/features/accounts/components/tds-reimbursement";
import { formatNumber } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { useSelector } from "@/store";

export type AccountTab = "my_usage" | "purchase_history" | "credit_history" | "plans" | "TDS_reimbursement";

const TAB_KEYS: readonly AccountTab[] = ["my_usage", "purchase_history", "credit_history", "plans", "TDS_reimbursement"];

/**
 * TrackVid `AccountSummary`. The active tab lives in `?tab=` (TrackVid used router state), so the
 * topbar wallet link `?tab=my_usage` and the usage-history day link `?tab=credit_history&date=` work.
 */
export function AccountSummaryPage() {
  const user = useSelector((s) => s.profile.userProfile);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const perms: Record<AccountTab, boolean> = {
    my_usage: canAccess(user, ["admin"], ["accounts::my_usage::view"]),
    purchase_history: canAccess(user, ["admin"], ["accounts::purchase_history::view"]),
    credit_history: canAccess(user, ["admin"], ["accounts::credit_history::view"]),
    plans: canAccess(user, ["admin"], ["accounts::plan::view"]),
    TDS_reimbursement: canAccess(user, ["admin"], ["accounts::tds_reimbursement::view"]),
  };

  const items: TabItem<AccountTab>[] = [
    { key: "my_usage", label: "My Usage", icon: "chart-bar", hidden: !perms.my_usage },
    { key: "purchase_history", label: "Purchase History", icon: "receipt", hidden: !perms.purchase_history },
    { key: "credit_history", label: "Credit History", icon: "history", hidden: !perms.credit_history },
    { key: "plans", label: "Plans", icon: "credit-card", hidden: !perms.plans },
    { key: "TDS_reimbursement", label: "TDS Reimbursement", icon: "percent", hidden: !perms.TDS_reimbursement },
  ];

  // Same default order as TrackVid: usage → purchase history → plans → credit history → TDS.
  const defaultTab = (["my_usage", "purchase_history", "plans", "credit_history", "TDS_reimbursement"] as const).find((k) => perms[k]);
  const requested = params.get("tab");
  const active: AccountTab | undefined =
    requested && (TAB_KEYS as readonly string[]).includes(requested) && perms[requested as AccountTab] ? (requested as AccountTab) : defaultTab;
  const dateParam = params.get("date");

  const goTo = (tab: AccountTab) => router.replace(`${pathname}?tab=${tab}`, { scroll: false });
  const remaining = user?.company.creditId.remainingCredit ?? 0;

  return (
    <div className="tv-page">
      <PageHeading
        title="Account Summary"
        subtitle={
          <>
            Credits, purchases and reimbursements for {user?.company.name ?? "your company"} · <strong>{formatNumber(remaining)}</strong> credits left
          </>
        }
        actions={
          perms.plans && canAccess(user, ["admin"], ["accounts::plan::edit"]) && active !== "plans" ? (
            <button type="button" className="primary-button" onClick={() => goTo("plans")}>
              <Icon name="plus" /> Buy credits
            </button>
          ) : null
        }
      />
      {active ? (
        <>
          <Tabs items={items} value={active} onChange={goTo} label="Account tabs" />
          <div className="tv-acc-tab-body" role="tabpanel">
            {active === "my_usage" ? <MyUsage /> : null}
            {active === "purchase_history" ? <PurchaseHistory /> : null}
            {active === "credit_history" ? <CreditHistory key={dateParam ?? "default"} initialDate={dateParam} /> : null}
            {active === "plans" ? <Plans onViewPurchases={() => goTo("purchase_history")} /> : null}
            {active === "TDS_reimbursement" ? <TdsReimbursement /> : null}
          </div>
        </>
      ) : (
        <section className="glass-card">
          <EmptyState icon="lock" title="No access" message="Your role does not include any Accounts section. Ask your admin for access." />
        </section>
      )}
    </div>
  );
}
