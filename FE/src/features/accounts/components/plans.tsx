"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CardHeading, IconTile } from "@/components/ui/card-primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { SkeletonCard } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PaymentStepsDialog, type PurchaseResult } from "@/features/accounts/components/payment-steps-dialog";
import { TIER_META, isCurrentPlan, planTotals } from "@/features/accounts/lib/accounts-helpers";
import { useWalletSync } from "@/features/accounts/lib/use-wallet-sync";
import { errorMessage, toast } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { CreditService } from "@/services/credit-service";
import { UserService } from "@/services/user-service";
import { useSelector } from "@/store";
import type { IPlan } from "@/types/common";

/** TrackVid `CreditPlans`: pricing cards with tier, best value ribbon, current pill and buy flow. */
function CreditPlans({ plans, canBuy, onBuy }: { plans: readonly IPlan[]; canBuy: boolean; onBuy: (plan: IPlan) => void }) {
  const current = useSelector((s) => s.profile.userProfile?.company.creditPlan);
  const sorted = [...plans].sort((a, b) => a.price - b.price);

  let popularId: string | undefined;
  let best = Infinity;
  for (const p of plans) {
    const total = (p.credit ?? 0) + (p.bonus ?? 0);
    if (total <= 0) continue;
    if (p.price / total < best) {
      best = p.price / total;
      popularId = p._id;
    }
  }

  if (!sorted.length) return <EmptyState icon="credit-card" title="No credit plans available" message="Please check back later or contact support." />;

  return (
    <div className="tv-acc-plan-grid">
      {sorted.map((plan, idx) => {
        const tier = TIER_META[Math.min(idx, TIER_META.length - 1)];
        const isCurrent = isCurrentPlan(plan, current);
        const isPopular = plan._id === popularId;
        const t = planTotals(plan);
        return (
          <article key={plan._id} className={`tv-plan-card tv-acc-plan ${isCurrent ? "is-current" : ""} ${isPopular ? "is-popular" : ""}`.replace(/\s+/g, " ").trim()}>
            {isPopular ? (
              <div className="tv-acc-plan-ribbon">
                <Icon name="star" /> Most Popular
              </div>
            ) : null}
            <div className="tv-row-between">
              <span className="tv-acc-tier">
                <IconTile name={tier.icon} tone={tier.tone} />
                {tier.label}
              </span>
              {isCurrent ? (
                <span className="c-status green">
                  <Icon name="check-circle" /> Current
                </span>
              ) : null}
            </div>
            <h3 className="tv-acc-plan-name">{plan.name}</h3>
            <div>
              <div className="tv-plan-price">
                <span className="tv-acc-currency">₹</span>
                {formatNumber(plan.price)}
              </div>
              <div className="tv-row tv-small tv-muted">
                ₹{t.perCredit} per credit
                {isPopular ? <span className="badge badge-success">Best value</span> : null}
              </div>
            </div>
            <hr className="tv-acc-dashed" />
            <ul className="tv-plan-features">
              <li className="tv-acc-line">
                <span>
                  <Icon name="sparkle" /> Plan credits
                </span>
                <strong>{formatNumber(plan.credit ?? 0)}</strong>
              </li>
              <li className="tv-acc-line">
                <span>
                  <Icon name="gift" /> Bonus credits
                </span>
                <strong className="tv-acc-bonus">
                  +{formatNumber(plan.bonus ?? 0)}
                  {t.bonusPct > 0 ? <span className="badge badge-coral">+{t.bonusPct}%</span> : null}
                </strong>
              </li>
            </ul>
            <div className="tv-acc-callout">
              <small>You get</small>
              <strong>{formatNumber(t.total)} credits</strong>
            </div>
            {canBuy ? (
              <button type="button" className={`${isPopular ? "primary-button" : "secondary-button"} tv-acc-plan-cta`} onClick={() => onBuy(plan)}>
                {isCurrent ? "Buy again" : "Purchase Plan"}
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

/** TrackVid `StoragePlans`: table of storage plans paid with credits, with an activate confirm. */
function StoragePlans({ plans, canEdit, onActivated }: { plans: readonly IPlan[]; canEdit: boolean; onActivated: (plan: IPlan) => void }) {
  const current = useSelector((s) => s.profile.userProfile?.company.storagePlan);
  const [target, setTarget] = useState<IPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = plans.map((p, i) => ({ ...p, no: i + 1 }));

  const activate = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await CreditService.upgradeStorage({ planId: target._id });
      toast.success(res.message);
      onActivated(res.plan);
      setTarget(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const columns: DataColumn<IPlan & { no: number }>[] = [
    { key: "no", header: "No", width: 60 },
    {
      key: "name",
      header: "Plan",
      minWidth: 160,
      render: (r) => (
        <span className="tv-row">
          {r.name}
          {isCurrentPlan(r, current) ? <span className="c-status green">Current</span> : null}
        </span>
      ),
    },
    {
      key: "price",
      header: "Credit",
      minWidth: 120,
      render: (r) => (
        <span className="tv-row">
          <Icon name="wallet" /> {formatNumber(r.price)}
        </span>
      ),
    },
    {
      key: "storage",
      header: "Storage",
      minWidth: 120,
      render: (r) => (
        <span className="tv-row">
          <Icon name="database" /> {formatNumber(r.storage ?? 0)} GB
        </span>
      ),
    },
    {
      key: "activePlan",
      header: "Active Plan",
      minWidth: 150,
      render: (r) =>
        canEdit ? (
          <button type="button" className="secondary-button compact-button" onClick={() => setTarget(r)} disabled={isCurrentPlan(r, current)}>
            Activate Plan
          </button>
        ) : (
          <span className="tv-muted">—</span>
        ),
    },
  ];

  return (
    <>
      <DataTable label="Storage plans" columns={columns} rows={rows} getRowId={(r) => r._id} pagination="none" emptyTitle="No storage plans" emptyMessage="Storage plans will appear here." />
      {target ? (
        <ConfirmDialog
          title={`Activate ${target.name} Plan`}
          message={
            <>
              Are you sure you want to activate {target.name} Plan? <strong>{formatNumber(target.price)} credits</strong> will be deducted from your wallet.
            </>
          }
          confirmLabel="Activate"
          busy={busy}
          onConfirm={() => void activate()}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </>
  );
}

/** TrackVid `Plans` tab: credit plan cards (+ storage plans) and the purchase flow. */
export function Plans({ onViewPurchases }: { onViewPurchases: () => void }) {
  const user = useSelector((s) => s.profile.userProfile);
  const canBuy = canAccess(user, ["admin"], ["accounts::plan::edit"]);
  const syncWallet = useWalletSync();
  const { data: plans, loading, error, reload } = useAsync(() => UserService.getPlans(), []);
  const [buying, setBuying] = useState<IPlan | null>(null);

  const creditPlans = (plans ?? []).filter((p) => p.type === "CREDIT" && p.isActive && !p.isDeleted);
  const storagePlans = (plans ?? []).filter((p) => p.type === "STORAGE" && p.isActive && !p.isDeleted);

  const onComplete = async (result: PurchaseResult) => {
    const plan = buying;
    setBuying(null);
    if (result.kind === "online" && plan) {
      await syncWallet({ creditPlan: plan });
      toast.success(`${formatNumber(result.creditAdded)} credits added to your wallet.`);
    } else {
      toast.info("We will credit your account after the payment is verified. Track it in Purchase History.");
      onViewPurchases();
    }
  };

  if (loading && !plans) {
    return (
      <div className="tv-acc-plan-grid">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} lines={6} />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={reload} title="Could not load plans" />;

  return (
    <div className="tv-stack tv-acc-plans">
      <div className="tv-acc-section-heading">
        <h3>Choose your credit plan</h3>
        <p>Pick a plan that matches your monthly volume — bonus credits added on every purchase.</p>
      </div>
      <CreditPlans plans={creditPlans} canBuy={canBuy} onBuy={setBuying} />
      <p className="tv-acc-trust">
        <span>
          <Icon name="lock" /> Secure checkout
        </span>
        <span aria-hidden="true">•</span>
        <span>All prices in INR</span>
        <span aria-hidden="true">•</span>
        <span>Bonus credits never expire</span>
      </p>

      {storagePlans.length ? (
        <section className="glass-card tv-table-card">
          <CardHeading title="Storage plans" extra={<span className="tv-muted tv-small">Paid from your credit wallet</span>} />
          <StoragePlans plans={storagePlans} canEdit={canBuy} onActivated={(plan) => void syncWallet({ storagePlan: plan })} />
        </section>
      ) : null}

      {buying ? <PaymentStepsDialog plan={buying} onClose={() => setBuying(null)} onComplete={(r) => void onComplete(r)} /> : null}
    </div>
  );
}
