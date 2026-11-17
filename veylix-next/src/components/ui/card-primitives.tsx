// @ts-nocheck
import { Icon } from "@/components/icons/icon";

export function CardHeading({ title, action, extra = null }) {
  return (
    <div className="card-heading">
      <h2>{title}</h2>
      {action ? (
        <button
          type="button"
          className="text-link"
          data-action={action}
          aria-label={`View all ${title.toLowerCase()}`}
        >
          {"View all "}
          <Icon name="arrow-right" />
        </button>
      ) : (
        extra
      )}
    </div>
  );
}

export function ToneBadge({ label, tone = "neutral" }) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

export function IconTile({ name: e, tone = "amber", className = "" }) {
  return (
    <span className={`icon-tile tile-${tone} ${className}`.trim()}>
      <Icon name={e} />
    </span>
  );
}

export function ProgressBar({ value, tone = "green" }) {
  const n = Math.min(100, Math.max(0, value));
  return (
    <span className="progress-track" aria-hidden="true">
      <span
        className={`progress-fill fill-${tone}`}
        style={{
          width: `${n}%`,
        }}
      />
    </span>
  );
}
