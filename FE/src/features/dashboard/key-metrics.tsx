"use client";

import type { ReactNode } from "react";
import type { IconName } from "@/components/icons/icon";
import { IconTile, type TileTone } from "@/components/ui/card-primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount } from "@/features/dashboard/dashboard-helpers";
import type { EmailMetricSummary, StatusCountRecord } from "@/types/dashboard";

type PillTone = "success" | "danger" | "info";

function MetricPill({ label, value, tone }: { label: string; value: number; tone: PillTone }) {
  return (
    <span className={`tv-dash-pillstat is-${tone}`}>
      <span>{label}</span>
      <b>{formatCount(value)}</b>
    </span>
  );
}

/** TrackVid `StatsCard`: icon + title, big count, a dashed row of breakdown pills. */
function StatsCard({
  title,
  icon,
  tone,
  count,
  loading,
  children,
}: {
  title: string;
  icon: IconName;
  tone: TileTone;
  count: number;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <section className="glass-card tv-dash-stat" aria-label={title} aria-busy={loading}>
      <div className="tv-metric-head">
        <IconTile name={icon} tone={tone} />
        <span>{title}</span>
      </div>
      {loading ? <Skeleton width="45%" height={30} /> : <strong className="tv-dash-stat-value">{formatCount(count)}</strong>}
      <div className="tv-dash-pillrow">{children}</div>
    </section>
  );
}

export interface KeyMetricsProps {
  statusCount: StatusCountRecord[];
  statusLoading: boolean;
  email: EmailMetricSummary;
  emailLoading: boolean;
  credit: { used: number; total: number; remaining: number };
  creditLoading: boolean;
  mailboxes: { total: number; healthy: number; disconnected: number };
  mailboxLoading: boolean;
}

/** "Key metrics" strip of `DashboardMaster` (four hero cards). */
export function KeyMetrics({ statusCount, statusLoading, email, emailLoading, credit, creditLoading, mailboxes, mailboxLoading }: KeyMetricsProps) {
  const physical = statusCount.find((s) => s.order_status === "Physically Return Received");
  return (
    <div className="tv-grid-4">
      <StatsCard title="Physically Return Received" icon="package" tone="info" count={physical?.totalCount ?? 0} loading={statusLoading}>
        <MetricPill label="Good" value={physical?.good ?? 0} tone="success" />
        <MetricPill label="Bad" value={physical?.bad ?? 0} tone="danger" />
      </StatsCard>
      <StatsCard title="AJIO Emails" icon="envelope" tone="blue" count={email.totalSent} loading={emailLoading}>
        <MetricPill label="Replied" value={email.replied} tone="success" />
        <MetricPill label="Failed" value={email.failed} tone="danger" />
        <MetricPill label="Manual" value={email.manual} tone="info" />
      </StatsCard>
      <StatsCard title="Remaining Credits" icon="wallet" tone="success" count={credit.remaining} loading={creditLoading}>
        <MetricPill label="Used" value={credit.used} tone="info" />
        <MetricPill label="Total" value={credit.total} tone="success" />
      </StatsCard>
      <StatsCard title="AJIO Mailboxes" icon="envelope" tone="amber" count={mailboxes.total} loading={mailboxLoading}>
        <MetricPill label="Healthy" value={mailboxes.healthy} tone="success" />
        <MetricPill label="Disconnected" value={mailboxes.disconnected} tone="danger" />
      </StatsCard>
    </div>
  );
}
