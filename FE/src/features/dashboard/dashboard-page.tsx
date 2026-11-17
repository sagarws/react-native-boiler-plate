"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { PageHeading } from "@/components/ui/page-heading";
import { CarrierCharts } from "@/features/dashboard/carrier-charts";
import { CmsStatusInsights } from "@/features/dashboard/cms-status-insights";
import { computePreset, fmtApiDate, formatRangeLabel } from "@/features/dashboard/dashboard-helpers";
import { DateRangeFilter } from "@/features/dashboard/date-range-filter";
import { InsightsRow } from "@/features/dashboard/insights-row";
import { KeyMetrics } from "@/features/dashboard/key-metrics";
import { PlatformInsightsTable } from "@/features/dashboard/platform-insights-table";
import { useAsync } from "@/lib/use-async";
import { AccountService } from "@/services/account-service";
import { DashboardService } from "@/services/dashboard-service";
import { EmailAutomationService } from "@/services/email-automation-service";
import { MailboxService } from "@/services/mailbox-service";
import { useSelector } from "@/store";
import type { CmsStatusRow, DateRangeValue, EmailMetricSummary, PlatformInsightsRow, PlatformSummaryRow, VideoRecordingsRow } from "@/types/dashboard";

const EMPTY_EMAIL: EmailMetricSummary = { totalSent: 0, replied: 0, failed: 0, manual: 0 };

function SectionHeader({ kicker, title, description, trailing }: { kicker: string; title: string; description: string; trailing?: ReactNode }) {
  return (
    <div className="tv-dash-section-head">
      <div>
        <small className="tv-dash-kicker is-accent">{kicker}</small>
        <h2 className="tv-section-title">{title}</h2>
        <p className="tv-muted tv-small">{description}</p>
      </div>
      {trailing}
    </div>
  );
}

/** Platform summary + recordings merged by name (TrackVid `platformInsightsRows`). */
function mergeInsights(platforms: PlatformSummaryRow[], recordings: VideoRecordingsRow[]): PlatformInsightsRow[] {
  const recs = new Map(recordings.map((v) => [v.name.toUpperCase(), v]));
  const seen = new Set<string>();
  const merged: PlatformInsightsRow[] = platforms.map((p) => {
    const key = p.name.toUpperCase();
    seen.add(key);
    const r = recs.get(key);
    return {
      name: p.name,
      total: p.total,
      pending: p.pending,
      remaining: p.remaining,
      success: p.success,
      automated: p.automated,
      manual: p.manual,
      forwardRecordings: r?.forward ?? 0,
      returnRecordings: r?.return ?? 0,
      totalRecordings: r?.total ?? 0,
    };
  });
  for (const v of recordings) {
    if (seen.has(v.name.toUpperCase())) continue;
    merged.push({
      name: v.name,
      total: 0,
      pending: 0,
      remaining: 0,
      success: 0,
      automated: 0,
      manual: 0,
      forwardRecordings: v.forward,
      returnRecordings: v.return,
      totalRecordings: v.total,
    });
  }
  return merged;
}

/** TrackVid `Dashboard` → `DashboardMaster`. */
export function DashboardPage() {
  const user = useSelector((s) => s.profile.userProfile);
  const [range, setRange] = useState<DateRangeValue>(() => computePreset("last7"));
  const startDate = fmtApiDate(range.startDate);
  const endDate = fmtApiDate(range.endDate);
  const apiDates = { startDate, endDate };
  const windowLabel = formatRangeLabel(range);

  const status = useAsync(() => DashboardService.getMasterOrderStatusCount(apiDates), [startDate, endDate]);
  // `from`/`to` widened to whole days: the mock email store filters by timestamp.
  const email = useAsync(() => EmailAutomationService.getTodayStats({ from: `${startDate}T00:00:00`, to: `${endDate}T23:59:59.999` }), [startDate, endDate]);
  const summary = useAsync(() => DashboardService.getCmsPlatformSummary({ ...apiDates, key: "selection" }, []), [startDate, endDate]);
  const recordings = useAsync(() => DashboardService.getVideoRecordingsByPlatform(apiDates), [startDate, endDate]);
  const carriers = useAsync(() => DashboardService.getMasterCarrierStatusCount(apiDates), [startDate, endDate]);
  // One-time, like TrackVid (account usage + mailbox health do not depend on the window).
  const usage = useAsync(() => AccountService.getAccountUsage(), []);
  const mailbox = useAsync(() => MailboxService.checkMailboxStatus(), []);

  const statusCount = status.data?.lineChartData[0]?.statusCounts ?? [];
  const platforms = summary.data?.platforms ?? [];
  const insightsRows = mergeInsights(platforms, recordings.data?.platforms ?? []);
  const cmsRows: CmsStatusRow[] = platforms.map((p) => ({
    name: p.name,
    total: p.total,
    pending: p.pending,
    inReview: p.inReview,
    approved: p.approved,
    rejected: p.rejected,
  }));
  const mailboxTotal = mailbox.data?.totalCount ?? 0;
  const mailboxDisconnected = mailbox.data?.disconnectedCount ?? 0;

  return (
    <div className="tv-page tv-dash">
      <PageHeading
        title="Master Dashboard"
        subtitle={
          <>
            {user?.company?.name ? `${user.company.name} · ` : null}
            Showing data for <strong className="tv-dash-window">{windowLabel}</strong>
          </>
        }
        actions={<DateRangeFilter value={range} onChange={setRange} />}
      />

      <section aria-labelledby="dash-key-metrics">
        <SectionHeader
          kicker="Snapshot"
          title="Key metrics"
          description="High-level counts for orders, automation, credits, and mailbox health within the selected window."
        />
        <KeyMetrics
          statusCount={statusCount}
          statusLoading={status.loading}
          email={email.data ?? EMPTY_EMAIL}
          emailLoading={email.loading}
          credit={usage.data?.credit ?? { used: 0, total: 0, remaining: 0 }}
          creditLoading={usage.loading}
          mailboxes={{ total: mailboxTotal, disconnected: mailboxDisconnected, healthy: Math.max(mailboxTotal - mailboxDisconnected, 0) }}
          mailboxLoading={mailbox.loading}
        />
      </section>

      <section>
        <SectionHeader
          kicker="Insights"
          title="Key performance ratios"
          description="Headline conversion and quality ratios for the selected window, with previous-period deltas."
        />
        <InsightsRow startDate={range.startDate} endDate={range.endDate} windowLabel={windowLabel} />
      </section>

      <section>
        <SectionHeader
          kicker="Platform insights"
          title="Per-platform performance"
          description="Claim volume, success and the automation vs manual split, success rate, and recordings — all sortable per column."
        />
        <PlatformInsightsTable
          rows={insightsRows}
          loading={summary.loading || recordings.loading}
          error={summary.error ?? recordings.error}
          onRetry={() => {
            summary.reload();
            recordings.reload();
          }}
        />
      </section>

      <section>
        <SectionHeader
          kicker="CMS status"
          title="Marketplace claims by status"
          description="Pending, In Review, Approved and Rejected claim volume per marketplace — total bar shows the status mix; pills show the exact counts."
        />
        <CmsStatusInsights rows={cmsRows} loading={summary.loading} error={summary.error} onRetry={summary.reload} />
      </section>

      <section>
        <SectionHeader
          kicker="Courier performance"
          title="Carrier benchmarks"
          description="How each courier compares on delivery speed and on the quality of returns they bring back."
          trailing={
            <span className="tv-dash-window-chip">
              <Icon name="truck" />
              {windowLabel}
            </span>
          }
        />
        <CarrierCharts orders={carriers.data?.orders ?? []} loading={carriers.loading} error={carriers.error} onRetry={carriers.reload} />
      </section>
    </div>
  );
}
