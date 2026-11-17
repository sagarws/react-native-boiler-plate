// @ts-nocheck
import { Icon } from "@/components/icons/icon";

export function ResourceToolbar({
  title,
  query,
  filter,
  archived,
  statuses,
  includeLowStock = false,
  onQueryChange,
  onFilterChange,
  onArchivedChange,
  extra,
}) {
  return (
    <div className="c-toolbar">
      <label className="c-search">
        <Icon name="search" />
        <input
          data-c-search
          type="search"
          placeholder={`Search ${title.toLowerCase()}...`}
          value={query}
          aria-label={`Search ${title}`}
          onChange={(e) => onQueryChange(e.currentTarget.value)}
        />
      </label>
      {statuses.length ? (
        <label className="c-filter">
          <span className="sr-only">Filter by status</span>
          <select
            data-c-filter
            value={filter}
            onChange={(e) => onFilterChange(e.currentTarget.value)}
          >
            <option value="">All statuses</option>
            {includeLowStock ? (
              <option value="Low stock">Low stock</option>
            ) : null}
            {statuses.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="c-archive-toggle">
        <input
          type="checkbox"
          data-c-archive
          checked={archived}
          onChange={(e) => onArchivedChange(e.currentTarget.checked)}
        />
        {" Archived"}
      </label>
      {extra}
    </div>
  );
}
