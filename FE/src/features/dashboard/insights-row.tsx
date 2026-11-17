"use client";

import { Icon, type IconName } from "@/components/icons/icon";
import { IconTile, type TileTone } from "@/components/ui/card-primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { computePeriods, formatCount, safePctDelta, safeRate } from "@/features/dashboard/dashboard-helpers";
import { useAsync } from "@/lib/use-async";
import { DashboardService } from "@/services/dashboard-service";
import { EmailAutomationService } from "@/services/email-automation-service";

interface PeriodDates {
  startDate: string;
  endDate: string;
}

interface KPISet {
  shipped: number;
  returnCreated: number;
  good: number;
  bad: number;
  approved: number;
  rejected: number;
}

interface EmailKPI {
  replied: number;
  failed: number;
  manual: number;
}

async function fetchKPIs(dates: PeriodDates): Promise<KPISet> {
  const res = await DashboardService.getMasterOrderStatusCount(dates);
  const rows = res.lineChartData[0]?.statusCounts ?? [];
  const find = (status: string) => rows.find((r) => r.order_status === status);
  const phys = find("Physically Return Received");
  const dispute = find("Return Dispute");
  return {
    shipped: find("Shipped")?.totalCount ?? 0,
    returnCreated: find("Return Created")?.totalCount ?? 0,
    good: phys?.good ?? 0,
    bad: phys?.bad ?? 0,
    approved: dispute?.approved ?? 0,
    rejected: dispute?.rejected ?? 0,
  };
}

async function fetchEmailKPI(dates: PeriodDates): Promise<EmailKPI> {
  const stats = await EmailAutomationService.getTodayStats({ from: `${dates.startDate}T00:00:00`, to: `${dates.endDate}T23:59:59.999` });
  return { replied: stats.replied, failed: stats.failed, manual: stats.manual };
}

interface InsightsData {
  current: KPISet | null;
  previous: KPISet | null;
  email: EmailKPI | null;
  emailPrev: EmailKPI | null;
}

/** allSettled like TrackVid: one failing endpoint must not blank out the other cards. */
async function loadInsights(current: PeriodDates, previous: PeriodDates): Promise<InsightsData> {
  const [c, p, e, ep] = await Promise.allSettled([fetchKPIs(current), fetchKPIs(previous), fetchEmailKPI(current), fetchEmailKPI(previous)]);
  return {
    current: c.status === "fulfilled" ? c.value : null,
    previous: p.status === "fulfilled" ? p.value : null,
    email: e.status === "fulfilled" ? e.value : null,
    emailPrev: ep.status === "fulfilled" ? ep.value : null,
  };
}

/** TrackVid `components/Dashboard/MetricCard`: ratio, delta vs previous period, subline and window label. */
function InsightCard({
  icon,
  tone,
  label,
  value,
  subline,
  tooltip,
  deltaPct,
  lowerIsBetter = false,
  loading,
  windowLabel,
}: {
  icon: IconName;
  tone: TileTone;
  label: string;
  value: number | null;
  subline: string;
  tooltip: string;
  deltaPct: number | null;
  lowerIsBetter?: boolean;
  loading: boolean;
  windowLabel: string;
}) {
  const direction = deltaPct === null || Math.abs(deltaPct) < 0.05 ? "flat" : deltaPct > 0 ? "up" : "down";
  const improvement = direction === "flat" ? null : (direction === "up") !== lowerIsBetter;
  const deltaTone = improvement === null ? "neutral" : improvement ? "good" : "bad";
  return (
    <section className="glass-card tv-dash-insight" aria-label={label} aria-busy={loading}>
      <div className="tv-row-between">
        <div className="tv-metric-head">
          <IconTile name={icon} tone={tone} />
          <span className="tv-dash-insight-label">{label}</span>
          <span className="tv-dash-info" title={tooltip} aria-label={tooltip} role="img">
            <Icon name="info" />
          </span>
        </div>
        {deltaPct !== null && !loading ? (
          <span className={`tv-dash-delta is-${deltaTone}`} title="Change vs the previous period of the same length">
            <Icon name={direction === "up" ? "arrow-up" : direction === "down" ? "arrow-down" : "minus"} />
            {direction === "flat" ? "no change" : `${Math.abs(deltaPct).toFixed(1)}%`}
          </span>
        ) : null}
      </div>
      <div className="tv-dash-insight-value">
        {loading ? (
          <Skeleton width="40%" height={28} />
        ) : (
          <>
            <strong>{value === null ? "—" : value.toFixed(1)}</strong>
            {value === null ? null : <span>%</span>}
          </>
        )}
      </div>
      <p className="tv-dash-insight-sub">{loading ? <Skeleton width="80%" /> : subline}</p>
      <small className="tv-dash-kicker">{windowLabel}</small>
    </section>
  );
}

/** TrackVid `DashboardInsightsRow`: Return Rate, Bad-Return Rate, Auto-Reply Rate, Claim Win Rate. */
export function InsightsRow({ startDate, endDate, windowLabel }: { startDate: Date; endDate: Date; windowLabel: string }) {
  const periods = computePeriods(startDate, endDate);
  const key = `${periods.current.startDate}|${periods.current.endDate}`;
  const { data, loading } = useAsync(() => loadInsights(periods.current, periods.previous), [key]);

  const current = data?.current ?? null;
  const previous = data?.previous ?? null;
  const email = data?.email ?? null;
  const emailPrev = data?.emailPrev ?? null;

  const returnRate = current ? safeRate(current.returnCreated, current.shipped) : null;
  const prevReturnRate = previous ? safeRate(previous.returnCreated, previous.shipped) : null;

  const badTotalCur = current ? current.good + current.bad : 0;
  const badRate = current ? safeRate(current.bad, badTotalCur) : null;
  const prevBadRate = previous ? safeRate(previous.bad, previous.good + previous.bad) : null;

  const emailDenCur = email ? email.replied + email.failed + email.manual : 0;
  const autoReplyRate = email ? safeRate(email.replied, emailDenCur) : null;
  const prevAutoReplyRate = emailPrev ? safeRate(emailPrev.replied, emailPrev.replied + emailPrev.failed + emailPrev.manual) : null;

  const claimTotalCur = current ? current.approved + current.rejected : 0;
  const claimWin = current ? safeRate(current.approved, claimTotalCur) : null;
  const prevClaimWin = previous ? safeRate(previous.approved, previous.approved + previous.rejected) : null;

  return (
    <div className="tv-grid-4">
      <InsightCard
        icon="truck"
        tone="info"
        label="Return Rate"
        value={returnRate}
        subline={
          current && current.shipped > 0
            ? `${formatCount(current.returnCreated)} returns of ${formatCount(current.shipped)} shipped`
            : "No shipments in this period"
        }
        tooltip="Share of shipped orders that ended up as returns (Return Created ÷ Shipped). Lower is generally better."
        deltaPct={safePctDelta(returnRate, prevReturnRate)}
        lowerIsBetter
        loading={loading}
        windowLabel={windowLabel}
      />
      <InsightCard
        icon="warning"
        tone="amber"
        label="Bad-Return Rate"
        value={badRate}
        subline={
          current && badTotalCur > 0
            ? `${formatCount(current.bad)} bad of ${formatCount(badTotalCur)} physically received`
            : "No physical returns inspected in this period"
        }
        tooltip="Share of physically received returns marked Bad (Bad ÷ (Good + Bad)). Lower is better — high values may indicate quality or packaging issues."
        deltaPct={safePctDelta(badRate, prevBadRate)}
        lowerIsBetter
        loading={loading}
        windowLabel={windowLabel}
      />
      <InsightCard
        icon="envelope"
        tone="blue"
        label="Auto-Reply Rate"
        value={autoReplyRate}
        subline={
          email && emailDenCur > 0
            ? `${formatCount(email.replied)} auto-replied of ${formatCount(emailDenCur)} processed`
            : "No emails processed in this period"
        }
        tooltip="Share of email automation attempts auto-replied without falling back to manual or failing (Replied ÷ (Replied + Failed + Manual)). Higher is better."
        deltaPct={safePctDelta(autoReplyRate, prevAutoReplyRate)}
        loading={loading}
        windowLabel={windowLabel}
      />
      <InsightCard
        icon="shield"
        tone="success"
        label="Claim Win Rate"
        value={claimWin}
        subline={
          current && claimTotalCur > 0
            ? `${formatCount(current.approved)} of ${formatCount(claimTotalCur)} disputes approved`
            : "No disputes resolved in this period"
        }
        tooltip="Percentage of return disputes that were approved (Approved ÷ (Approved + Rejected)). Higher is better."
        deltaPct={safePctDelta(claimWin, prevClaimWin)}
        loading={loading}
        windowLabel={windowLabel}
      />
    </div>
  );
}
