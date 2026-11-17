import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/icon";

export function CardHeading({ title, extra }: { title: ReactNode; extra?: ReactNode }) {
  return (
    <div className="card-heading">
      <h2>{title}</h2>
      {extra}
    </div>
  );
}

export type BadgeTone = "success" | "info" | "blue" | "danger" | "amber" | "neutral" | "coral";

export function ToneBadge({ label, tone = "neutral" }: { label: ReactNode; tone?: BadgeTone }) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

export type TileTone = "amber" | "success" | "blue" | "coral" | "danger" | "info" | "neutral" | "orange";

export function IconTile({ name, tone = "amber", className = "" }: { name: IconName; tone?: TileTone; className?: string }) {
  return (
    <span className={`icon-tile tile-${tone} ${className}`.trim()}>
      <Icon name={name} />
    </span>
  );
}

export function ProgressBar({ value, tone = "green" }: { value: number; tone?: "green" | "amber" | "red" | "blue" }) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <span className="progress-track" aria-hidden="true">
      <span className={`progress-fill fill-${tone}`} style={{ width: `${width}%` }} />
    </span>
  );
}

/** A metric card: icon, label, big value, optional caption. */
export function MetricCard({
  icon,
  tone = "amber",
  label,
  value,
  caption,
  loading = false,
}: {
  icon: IconName;
  tone?: TileTone;
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  loading?: boolean;
}) {
  return (
    <section className="glass-card tv-metric" aria-label={label}>
      <div className="tv-metric-head">
        <IconTile name={icon} tone={tone} />
        <span>{label}</span>
      </div>
      {loading ? <span className="tv-skeleton" style={{ height: 30, width: "60%" }} /> : <strong className="tv-metric-value">{value}</strong>}
      {caption ? <small>{caption}</small> : null}
    </section>
  );
}
