// @ts-nocheck
import { Fragment, useEffect, useRef } from "react";
import { Icon } from "@/components/icons/icon";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import {
  formatProductUpdatedAt,
  getProductStockStatus,
  getProductThumbnail,
} from "@/features/products/lib/product-helpers";
import { showToast } from "@/lib/events";
import { compactUsdFormatter, integerFormatter } from "@/lib/intl-formatters";
import { hydrateProductImages } from "@/lib/media-storage";

const productTableColumns = [
  ["name", "Product"],
  ["sku", "SKU"],
  ["category", "Category"],
  ["brand", "Brand"],
  ["status", "Status"],
  ["inventory", "Inventory"],
  ["sales", "Sales"],
  ["revenue", "Revenue"],
  ["trend", "Trend"],
  ["rating", "Rating"],
  ["modified", "Modified"],
];

function ProductStatusBadge({ row }) {
  const t = getProductStockStatus(row);
  return (
    <span
      className={`product-status ${t === "Active" ? "green" : t === "Low stock" ? "amber" : t === "Out of stock" ? "red" : "blue"}`}
    >
      <i />
      {t}
    </span>
  );
}

function ProductInventoryMeter({ row }) {
  const t = Number(row.stock || 0);
  const n = Math.max(Number(row.threshold || 15), 1);
  const r = Math.max(160, n * 4, t);
  const i = Math.max(2, Math.min(100, (t / r) * 100));
  return (
    <div
      className={`product-inventory ${t <= 0 ? "red" : t <= n ? "amber" : "green"}`}
    >
      <strong>
        {integerFormatter.format(t)}
        {" in stock"}
      </strong>
      <span>
        <i
          style={{
            width: `${i.toFixed(1)}%`,
          }}
        />
      </span>
    </div>
  );
}

function ProductTrendSparkline({ row }) {
  const t = Number(row.trend || 0);
  const n = Number(String(row.id || "").match(/\d+/)?.[0] || 1);
  const r = Array.from(
    {
      length: 8,
    },
    (e, r) => 24 + (t / 4) * r + Math.sin((n + r) * 1.17) * 4,
  );
  const i = Math.min(...r);
  const a = Math.max(...r) - i || 1;
  const o = r
    .map(
      (e, t) =>
        `${((t * 72) / 7).toFixed(1)},${(30 - ((e - i) / a) * 24).toFixed(1)}`,
    )
    .join(" ");
  return (
    <div className={`product-trend ${t < 0 ? "down" : "up"}`}>
      <svg
        viewBox="0 0 72 32"
        role="img"
        aria-label={`${t >= 0 ? "Up" : "Down"} ${Math.abs(t).toFixed(1)} percent`}
      >
        <polyline points={o} />
      </svg>
      <small>
        {t > 0 ? "+" : ""}
        {t.toFixed(1)}%
      </small>
    </div>
  );
}

function ProductRating({ row }) {
  const t = Number(row.rating || 0);
  return t ? (
    <span className="product-rating">
      <Icon name="star" /> {t.toFixed(1)}
    </span>
  ) : (
    <span className="product-empty-value">—</span>
  );
}

function ProductNameCell({ row }) {
  return (
    <Fragment>
      <OverviewProductThumb product={getProductThumbnail(row)} />
      <span>
        <strong>{String(row.name || "")}</strong>
        <small>
          {String(row.category || "Uncategorized")}
          {" · "}
          {String(row.brand || "No brand")}
        </small>
      </span>
    </Fragment>
  );
}

function ProductRowActions({
  row,
  archived,
  onDetail,
  onEdit,
  onRestore,
  onDuplicate,
  onShare,
  onActivity,
  onDelete,
}) {
  const l = archived
    ? [
        {
          label: "View",
          icon: "eye",
          onClick: () => onDetail(row.id),
        },
        {
          label: "Activity",
          icon: "history",
          onClick: () => onActivity(row.id),
        },
        {
          label: "Restore",
          icon: "check-circle",
          onClick: () => onRestore(row.id),
        },
      ]
    : [
        {
          label: "View",
          icon: "eye",
          onClick: () => onDetail(row.id),
        },
        {
          label: "Edit",
          icon: "pencil",
          onClick: () => onEdit(row.id),
        },
        {
          label: "Duplicate",
          icon: "copy",
          onClick: () => onDuplicate(row.id),
        },
        {
          label: "Share",
          icon: "share",
          onClick: () => onShare(row.id),
        },
        {
          label: "Activity",
          icon: "history",
          onClick: () => onActivity(row.id),
        },
        {
          label: "Delete",
          icon: "trash",
          danger: true,
          separatorBefore: true,
          onClick: () => onDelete(row.id),
        },
      ];
  return (
    <RowActionsMenu
      label={String(row.name || "")}
      actions={l}
      estimatedHeight={archived ? 150 : 315}
    />
  );
}

export function ProductsTable(e) {
  const {
    rows,
    selected,
    sort,
    direction,
    archived,
    onSort,
    onToggleRow,
    onToggleAll,
    onDetail,
    onEdit,
    onRestore,
    onDuplicate,
    onShare,
    onActivity,
    onDelete,
  } = e;
  const _ = useRef(null);
  const v = rows.length > 0 && rows.every((e) => selected.has(e.id));
  const y = rows.some((e) => selected.has(e.id));
  const b = useRef(null);
  useEffect(() => {
    if (b.current) {
      b.current.indeterminate = y && !v;
    }
  }, [y, v]);
  useEffect(() => {
    if (_.current) {
      hydrateProductImages(_.current).catch((e) =>
        showToast(
          e instanceof Error ? e.message : "Product image could not be loaded.",
        ),
      );
    }
  }, [rows, selected, sort, direction, archived]);
  const x = (e, t) => (
    <th
      key={e}
      scope="col"
      aria-sort={
        sort === e ? (direction === 1 ? "ascending" : "descending") : "none"
      }
    >
      <button type="button" onClick={() => onSort(e)}>
        {t}
        <Icon name={sort === e && direction < 0 ? "arrow-down" : "arrow-up"} />
      </button>
    </th>
  );
  return (
    <div
      className="table-scroll c-table-scroll product-table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Product records"
      ref={_}
    >
      <table className="c-table product-table">
        <thead>
          <tr>
            <th scope="col" className="c-check">
              <input
                ref={b}
                type="checkbox"
                checked={v}
                onChange={(e) => onToggleAll(e.currentTarget.checked)}
                aria-label="Select all visible products"
              />
            </th>
            {productTableColumns.map(([e, t]) => x(e, t))}
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} data-row-id={e.id}>
              <td className="c-check">
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  onChange={(t) => onToggleRow(e.id, t.currentTarget.checked)}
                  aria-label={`Select ${String(e.name || e.id)}`}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="c-record-name product-record-name"
                  onClick={() => onDetail(e.id)}
                >
                  <ProductNameCell row={e} />
                </button>
              </td>
              <td>
                <span className="product-mono">{String(e.sku || "—")}</span>
              </td>
              <td>{String(e.category || "—")}</td>
              <td>{String(e.brand || "—")}</td>
              <td>
                <ProductStatusBadge row={e} />
              </td>
              <td>
                <ProductInventoryMeter row={e} />
              </td>
              <td>{integerFormatter.format(Number(e.sold || 0))}</td>
              <td>
                <strong>
                  {compactUsdFormatter.format(
                    Number(e.sold || 0) * Number(e.price || 0),
                  )}
                </strong>
              </td>
              <td>
                <ProductTrendSparkline row={e} />
              </td>
              <td>
                <ProductRating row={e} />
              </td>
              <td>
                <span className="product-date">
                  {formatProductUpdatedAt(e)}
                </span>
              </td>
              <td className="product-actions-cell">
                <ProductRowActions
                  row={e}
                  archived={archived}
                  onDetail={onDetail}
                  onEdit={onEdit}
                  onRestore={onRestore}
                  onDuplicate={onDuplicate}
                  onShare={onShare}
                  onActivity={onActivity}
                  onDelete={onDelete}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
