"use client";

import type { ReactNode } from "react";
import { IconTile, ProgressBar, type TileTone } from "@/components/ui/card-primitives";
import type { IconName } from "@/components/icons/icon";
import { SkeletonCard } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { AccountService } from "@/services/account-service";
import { useSelector } from "@/store";
import { UsageHistory } from "@/features/accounts/components/usage-history";

function KpiCard({
  label,
  value,
  subtitle,
  icon,
  tone,
  progress,
  progressTone = "blue",
  footer,
}: {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  icon: IconName;
  tone: TileTone;
  progress?: number;
  progressTone?: "green" | "amber" | "red" | "blue";
  footer?: ReactNode;
}) {
  return (
    <section className="glass-card tv-acc-kpi" aria-label={label}>
      <div className="tv-acc-kpi-head">
        <IconTile name={icon} tone={tone} />
        <span>{label}</span>
      </div>
      <strong className="tv-acc-kpi-value">{value}</strong>
      {subtitle ? <small className="tv-acc-kpi-sub">{subtitle}</small> : null}
      {typeof progress === "number" ? (
        <div className="tv-acc-kpi-progress">
          <ProgressBar value={progress} tone={progressTone} />
        </div>
      ) : null}
      {footer ? <div className="tv-acc-kpi-foot">{footer}</div> : null}
    </section>
  );
}

/** TrackVid `MyUsages` (KPI cards) + `UsageHistory` (year / month / day table). */
export function MyUsage() {
  const user = useSelector((s) => s.profile.userProfile);
  const remainingKey = user?.company.creditId.remainingCredit ?? 0;
  const storageKey = user?.company.creditId.totalStorage ?? 0;
  const { data: usage, loading, error, reload } = useAsync(() => AccountService.getAccountUsage(), [remainingKey, storageKey]);

  const plan = user?.company.creditPlan;
  const planCredit = plan?.credit ?? 0;
  const planBonus = plan?.bonus ?? 0;

  let body: ReactNode;
  if (loading && !usage) {
    body = (
      <div className="tv-acc-kpi-grid">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} lines={3} />
        ))}
      </div>
    );
  } else if (error) {
    body = <ErrorState message={error} onRetry={reload} title="Could not load your usage" />;
  } else if (usage) {
    const { used, total } = usage.credit;
    const remaining = Math.max(total - used, 0);
    const usedPct = total > 0 ? Math.round((used / total) * 100) : 0;
    const remainingPct = total > 0 ? 100 - usedPct : 0;
    const remainingTone = remainingPct <= 10 ? "red" : remainingPct <= 25 ? "amber" : "green";
    const storagePct = usage.storage.total > 0 ? Math.round((usage.storage.used / usage.storage.total) * 100) : 0;
    body = (
      <>
        <div className="tv-acc-kpi-grid">
          <KpiCard
            label="Remaining Credit"
            value={formatNumber(remaining)}
            subtitle={
              <>
                <b>{remainingPct}%</b> of {formatNumber(total)} available
              </>
            }
            icon="wallet"
            tone="success"
            progress={remainingPct}
            progressTone={remainingTone}
          />
          <KpiCard
            label="Used Credit"
            value={formatNumber(used)}
            subtitle={
              <>
                <b>{usedPct}%</b> of total consumed
              </>
            }
            icon="arrow-down"
            tone="info"
            progress={usedPct}
            progressTone="blue"
          />
          <KpiCard
            label="Total Credit"
            value={formatNumber(total)}
            subtitle={`${formatNumber(planCredit)} plan + ${formatNumber(planBonus)} bonus`}
            icon="sparkle"
            tone="coral"
            footer={
              <div className="tv-row">
                <span className="badge badge-info" title="Plan credits">
                  Plan {formatNumber(planCredit)}
                </span>
                <span className="badge badge-coral" title="Bonus credits">
                  Bonus {formatNumber(planBonus)}
                </span>
              </div>
            }
          />
          <KpiCard
            label="Current Plan"
            value={plan?.name ?? "Active Plan"}
            subtitle={
              <>
                <b>₹{formatNumber(plan?.price ?? 0)}</b> / cycle
              </>
            }
            icon="crown"
            tone="amber"
            footer={<span className="c-status green">Active</span>}
          />
        </div>
        <section className="glass-card tv-acc-storage" aria-label="Storage">
          <IconTile name="database" tone="info" />
          <div className="tv-acc-storage-body">
            <div className="tv-row-between">
              <strong>Storage</strong>
              <span className="tv-muted tv-small">
                {usage.storage.used.toFixed(1)} GB used of {formatNumber(usage.storage.total)} GB · {usage.storage.remaining.toFixed(1)} GB free
              </span>
            </div>
            <ProgressBar value={storagePct} tone={storagePct >= 90 ? "red" : storagePct >= 75 ? "amber" : "green"} />
          </div>
        </section>
      </>
    );
  }

  return (
    <div className="tv-stack tv-acc-usage">
      {body}
      <UsageHistory />
    </div>
  );
}
