"use client";

import type { IconName } from "@/components/icons/icon";
import { IconTile, type TileTone } from "@/components/ui/card-primitives";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { SkeletonCard } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { formatCount, platformDisplayName } from "@/features/dashboard/dashboard-helpers";
import type { CmsStatusRow } from "@/types/dashboard";

type StatusKey = "pending" | "inReview" | "approved" | "rejected";

const STATUS_META: Record<StatusKey, { label: string; icon: IconName; tone: TileTone }> = {
  pending: { label: "Pending", icon: "timer", tone: "amber" },
  inReview: { label: "In Review", icon: "file-text", tone: "blue" },
  approved: { label: "Approved", icon: "check-circle", tone: "success" },
  rejected: { label: "Rejected", icon: "x-circle", tone: "danger" },
};

const STATUS_ORDER: readonly StatusKey[] = ["pending", "inReview", "approved", "rejected"];

/**
 * Each status's share of the four tracked statuses, to one decimal, summing to exactly 100.0
 * (TrackVid `statusShares`): the denominator is the four-status sum, not `row.total`, and the
 * leftover tenths go to the largest remainders. All null when the four are zero.
 */
function statusShares(row: CmsStatusRow): Record<StatusKey, number | null> {
  const counts = STATUS_ORDER.map((k) => Math.max(0, row[k]));
  const denominator = counts.reduce((a, b) => a + b, 0);
  if (denominator <= 0) return { pending: null, inReview: null, approved: null, rejected: null };
  const TENTHS = 1000;
  const exact = counts.map((c) => (c / denominator) * TENTHS);
  const tenths = exact.map((v) => Math.floor(v));
  let leftover = TENTHS - tenths.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((v, i) => ({ i, remainder: v - tenths[i] })).sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let n = 0; n < byRemainder.length && leftover > 0; n++) {
    tenths[byRemainder[n].i] += 1;
    leftover -= 1;
  }
  return { pending: tenths[0] / 10, inReview: tenths[1] / 10, approved: tenths[2] / 10, rejected: tenths[3] / 10 };
}

function StatusTile({ status, value, share }: { status: StatusKey; value: number; share: number | null }) {
  const meta = STATUS_META[status];
  return (
    <section className={`glass-card tv-dash-status-tile is-${status}`} aria-label={meta.label}>
      <div className="tv-metric-head">
        <IconTile name={meta.icon} tone={meta.tone} />
        <span>{meta.label}</span>
      </div>
      <strong>{formatCount(value)}</strong>
      <small>{share === null ? "—" : `${share.toFixed(1)}% of all claims`}</small>
    </section>
  );
}

function SegmentBar({ row }: { row: CmsStatusRow }) {
  if (row.total <= 0) return <div className="tv-dash-segbar is-empty" aria-hidden="true" />;
  return (
    <div className="tv-dash-segbar" role="img" aria-label={STATUS_ORDER.map((k) => `${STATUS_META[k].label} ${row[k]}`).join(", ")}>
      {STATUS_ORDER.filter((k) => row[k] > 0).map((k) => (
        <span key={k} className={`is-${k}`} style={{ flex: `${row[k]} 0 0` }} title={`${STATUS_META[k].label}: ${formatCount(row[k])}`} />
      ))}
    </div>
  );
}

function PlatformPanel({ row }: { row: CmsStatusRow }) {
  const inactive = row.total === 0;
  const shares = statusShares(row);
  return (
    <section className={`glass-card tv-dash-panel ${inactive ? "is-inactive" : ""}`.trim()} aria-label={platformDisplayName(row.name)}>
      <div className="tv-row-between">
        <div className="tv-row" style={{ flexWrap: "nowrap" }}>
          <PlatformLogo name={row.name} showName={false} large />
          <div>
            <strong className="tv-dash-panel-name">{platformDisplayName(row.name)}</strong>
            <small className="tv-muted">{inactive ? "No claims in this period" : "Claims"}</small>
          </div>
        </div>
        <strong className="tv-dash-panel-total">{formatCount(row.total)}</strong>
      </div>
      <SegmentBar row={row} />
      <div className="tv-dash-statuspills">
        {STATUS_ORDER.map((k) => (
          <span key={k} className={`tv-dash-statuspill is-${k}`}>
            <i aria-hidden="true" />
            <span>{STATUS_META[k].label}</span>
            <b>{formatCount(row[k])}</b>
            {shares[k] !== null ? <em>{shares[k]?.toFixed(1)}%</em> : null}
          </span>
        ))}
      </div>
    </section>
  );
}

/** TrackVid `CmsStatusInsights`: aggregate status tiles + one panel per marketplace. */
export function CmsStatusInsights({ rows, loading, error, onRetry }: { rows: CmsStatusRow[]; loading: boolean; error: string | null; onRetry: () => void }) {
  if (error && !loading) {
    return (
      <section className="glass-card">
        <ErrorState message={error} onRetry={onRetry} />
      </section>
    );
  }
  if (!loading && rows.length === 0) {
    return (
      <section className="glass-card">
        <EmptyState icon="clipboard-text" title="No CMS claims" message="No CMS claims for the selected period." />
      </section>
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      pending: acc.pending + r.pending,
      inReview: acc.inReview + r.inReview,
      approved: acc.approved + r.approved,
      rejected: acc.rejected + r.rejected,
    }),
    { total: 0, pending: 0, inReview: 0, approved: 0, rejected: 0 },
  );
  const sorted = [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return (
    <div className="tv-stack" style={{ gap: "var(--grid-gap)" }}>
      <div className="tv-grid-4">
        {STATUS_ORDER.map((k) =>
          loading ? (
            <SkeletonCard key={k} lines={1} />
          ) : (
            <StatusTile key={k} status={k} value={totals[k]} share={totals.total > 0 ? (totals[k] / totals.total) * 100 : null} />
          ),
        )}
      </div>
      <div className="tv-grid-3">
        {loading ? Array.from({ length: 6 }, (_, i) => <SkeletonCard key={`skel-${i}`} lines={3} height={152} />) : sorted.map((row) => <PlatformPanel key={row.name} row={row} />)}
      </div>
    </div>
  );
}
