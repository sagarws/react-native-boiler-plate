// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { getMarketplaceReviewTone } from "@/features/marketplace/lib/marketplace-review";

export function MarketplaceReviewPill({ value }) {
  return (
    <span
      className={`marketplace-review-pill ${getMarketplaceReviewTone(value)}`}
    >
      <i />
      {String(value || "—")}
    </span>
  );
}

export function MarketplaceReviewScore({ value, label = "readiness" }) {
  const n = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div
      className={`marketplace-review-score ${n >= 90 ? "green" : n >= 75 ? "amber" : "red"}`}
    >
      <div>
        <strong>{Math.round(n)}%</strong>
        <small>{label}</small>
      </div>
      <span>
        <i
          style={{
            width: `${n}%`,
          }}
        />
      </span>
    </div>
  );
}

export function VendorSummaryCard({
  icon,
  label,
  value,
  detail,
  tone = "green",
}) {
  return (
    <article className={`vendor-summary-card ${tone}`}>
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </article>
  );
}

export function MarketplaceSortableHeader({
  label,
  sortKey,
  sort,
  direction,
  onSort,
}) {
  return (
    <th
      scope="col"
      aria-sort={
        sort === sortKey
          ? direction === 1
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button type="button" onClick={() => onSort(sortKey)}>
        {label}
        <Icon
          name={sort === sortKey && direction < 0 ? "arrow-down" : "arrow-up"}
        />
      </button>
    </th>
  );
}
