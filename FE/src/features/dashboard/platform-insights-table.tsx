"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { DataTable, type DataColumn, type SortDirection } from "@/components/ui/data-table";
import { ProgressBar } from "@/components/ui/card-primitives";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { formatCount, platformDisplayName } from "@/features/dashboard/dashboard-helpers";
import type { PlatformInsightsRow } from "@/types/dashboard";

type SortKey =
  | "name"
  | "total"
  | "success"
  | "automated"
  | "manual"
  | "remaining"
  | "successRate"
  | "forwardRecordings"
  | "returnRecordings"
  | "totalRecordings";

const successRate = (row: PlatformInsightsRow): number | null => (row.total <= 0 ? null : (row.success / row.total) * 100);

type RateTone = "good" | "warn" | "bad" | "muted";
const rateTone = (rate: number | null): RateTone => (rate === null ? "muted" : rate >= 80 ? "good" : rate >= 50 ? "warn" : "bad");
const barTone: Record<RateTone, "green" | "amber" | "red" | "blue"> = { good: "green", warn: "amber", bad: "red", muted: "blue" };

function sortValue(row: PlatformInsightsRow, key: SortKey): string | number {
  if (key === "name") return row.name.toLowerCase();
  if (key === "successRate") return successRate(row) ?? -1;
  return row[key];
}

function SummaryStat({ label, value, tone = "default", icon }: { label: string; value: string; tone?: "default" | RateTone; icon?: "truck" | "arrow-left" | "video-camera" }) {
  return (
    <div className="tv-dash-sumstat">
      <span>{label}</span>
      <strong className={`is-${tone}`}>
        {icon ? <Icon name={icon} /> : null}
        {value}
      </strong>
    </div>
  );
}

function CountPill({ value, tone }: { value: number; tone: "auto" | "manual" }) {
  return (
    <span className={`tv-dash-countpill ${value > 0 ? `is-${tone}` : ""}`.trim()}>
      {value > 0 ? <i aria-hidden="true" /> : null}
      {formatCount(value)}
    </span>
  );
}

const num = (value: number, tone?: "good" | "warn") => <span className={`tv-dash-num ${tone ? `is-${tone}` : ""} ${value > 0 ? "" : "is-zero"}`.trim()}>{formatCount(value)}</span>;

/** TrackVid `PlatformInsightsTable`: summary strip + sortable per-platform table (claims, automation, recordings). */
export function PlatformInsightsTable({ rows, loading, error, onRetry }: { rows: PlatformInsightsRow[]; loading: boolean; error: string | null; onRetry: () => void }) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({ key: "total", direction: "desc" });

  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      success: acc.success + r.success,
      remaining: acc.remaining + r.remaining,
      forward: acc.forward + r.forwardRecordings,
      returned: acc.returned + r.returnRecordings,
      recordings: acc.recordings + r.totalRecordings,
    }),
    { total: 0, success: 0, remaining: 0, forward: 0, returned: 0, recordings: 0 },
  );
  const overallRate = totals.total > 0 ? (totals.success / totals.total) * 100 : null;

  const key = sort.key as SortKey;
  const sorted = [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av < bv) return sort.direction === "asc" ? -1 : 1;
    if (av > bv) return sort.direction === "asc" ? 1 : -1;
    return 0;
  });

  const columns: DataColumn<PlatformInsightsRow>[] = [
    {
      key: "name",
      header: "Platform",
      width: 220,
      sortable: true,
      render: (row) => (
        <span className="tv-row" style={{ flexWrap: "nowrap" }}>
          <PlatformLogo name={row.name} showName={false} />
          <strong>{platformDisplayName(row.name)}</strong>
          {row.total === 0 && row.totalRecordings === 0 ? <span className="badge badge-neutral">No activity</span> : null}
        </span>
      ),
    },
    { key: "total", header: "Claims", width: 100, align: "right", sortable: true, render: (r) => <strong>{formatCount(r.total)}</strong> },
    { key: "success", header: "Success", width: 100, align: "right", sortable: true, render: (r) => num(r.success, "good") },
    { key: "automated", header: "Automated", width: 120, align: "right", sortable: true, render: (r) => <CountPill value={r.automated} tone="auto" /> },
    { key: "manual", header: "Manual", width: 110, align: "right", sortable: true, render: (r) => <CountPill value={r.manual} tone="manual" /> },
    { key: "remaining", header: "Remaining", width: 110, align: "right", sortable: true, render: (r) => num(r.remaining, "warn") },
    {
      key: "successRate",
      header: "Success rate",
      width: 220,
      sortable: true,
      render: (r) => {
        const rate = successRate(r);
        const tone = rateTone(rate);
        return (
          <span className="tv-dash-rate">
            <ProgressBar value={rate ?? 0} tone={barTone[tone]} />
            <b className={`is-${tone}`}>{rate === null ? "—" : `${rate.toFixed(1)}%`}</b>
          </span>
        );
      },
    },
    { key: "forwardRecordings", header: "Forward", width: 100, align: "right", sortable: true, render: (r) => num(r.forwardRecordings) },
    { key: "returnRecordings", header: "Return", width: 100, align: "right", sortable: true, render: (r) => num(r.returnRecordings) },
    {
      key: "totalRecordings",
      header: "Total recs",
      width: 120,
      align: "right",
      sortable: true,
      render: (r) => (
        <span className={`tv-dash-recs ${r.totalRecordings > 0 ? "" : "is-zero"}`.trim()}>
          <Icon name="video-camera" />
          <strong>{formatCount(r.totalRecordings)}</strong>
        </span>
      ),
    },
  ];

  return (
    <section className="glass-card tv-table-card">
      {!loading && !error && rows.length > 0 ? (
        <div className="tv-dash-summary">
          <SummaryStat label="Total claims" value={formatCount(totals.total)} />
          <SummaryStat label="Resolved" value={formatCount(totals.success)} tone="good" />
          <SummaryStat label="Remaining" value={formatCount(totals.remaining)} tone="warn" />
          <SummaryStat label="Overall success" value={overallRate === null ? "—" : `${overallRate.toFixed(1)}%`} tone={rateTone(overallRate)} />
          <SummaryStat label="Forward recs" value={formatCount(totals.forward)} icon="truck" />
          <SummaryStat label="Return recs" value={formatCount(totals.returned)} icon="arrow-left" />
          <SummaryStat label="Total recs" value={formatCount(totals.recordings)} icon="video-camera" />
        </div>
      ) : null}
      <DataTable
        label="Per-platform performance"
        columns={columns}
        rows={sorted}
        getRowId={(r) => r.name}
        loading={loading}
        error={error}
        onRetry={onRetry}
        sort={sort}
        onSortChange={(next) =>
          setSort((prev) =>
            prev.key === next.key ? next : { key: next.key, direction: next.key === "name" ? "asc" : "desc" },
          )
        }
        pagination="none"
        emptyTitle="No platform data"
        emptyMessage="No platform data for the selected period."
        rowClassName={(r) => (r.total === 0 && r.totalRecordings === 0 ? "tv-dash-inactive" : "")}
        minTableWidth={1180}
      />
    </section>
  );
}
