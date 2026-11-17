// @ts-nocheck
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons/icon";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { getProductThumbnail } from "@/features/products/lib/product-helpers";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { integerFormatter } from "@/lib/intl-formatters";
import { hydrateProductImages } from "@/lib/media-storage";

function VariantStatusBadge({ row }) {
  const t = String(row.status || "") === "Active";
  return (
    <span className={`product-status ${t ? "green" : "blue"}`}>
      <i />
      {String(row.status || "Disabled")}
    </span>
  );
}

function VariantStockMeter({ row }) {
  const t = Number(row.stock || 0);
  const n = t <= 0 ? "red" : t <= 5 ? "amber" : "green";
  const r = Math.max(3, Math.min(100, (t / 40) * 100));
  return (
    <div className={`catalog-variant-stock ${n}`}>
      <strong>
        {integerFormatter.format(t)}
        {" units"}
      </strong>
      <span>
        <i
          style={{
            width: `${r.toFixed(0)}%`,
          }}
        />
      </span>
    </div>
  );
}

function VariantRowActions({
  row,
  archived,
  onManage,
  onViewProduct,
  onCopySku,
  onToggleStatus,
  onArchive,
  onRestore,
}) {
  const c = archived
    ? [
        {
          label: "Restore variant",
          icon: "check-circle",
          onClick: () => onRestore(row.id),
        },
      ]
    : [
        {
          label: "Manage product options",
          icon: "pencil",
          onClick: () => onManage(row.id),
        },
        {
          label: "View product",
          icon: "eye",
          onClick: () => onViewProduct(row.id),
        },
        {
          label: "Copy SKU",
          icon: "copy",
          onClick: () => onCopySku(row.id),
        },
        {
          label:
            String(row.status || "") === "Active"
              ? "Disable variant"
              : "Enable variant",
          icon: String(row.status || "") === "Active" ? "info" : "check-circle",
          onClick: () => onToggleStatus(row.id),
        },
        {
          label: "Archive variant",
          icon: "trash",
          danger: true,
          separatorBefore: true,
          onClick: () => onArchive(row.id),
        },
      ];
  return (
    <RowActionsMenu
      label={`${String(row.name || "")} variant`}
      actions={c}
      panelClassName="catalog-row-menu-panel"
      estimatedHeight={archived ? 90 : 280}
    />
  );
}

export function VariantsTable(e) {
  const {
    rows,
    products,
    selected,
    sort,
    direction,
    archived,
    onSort,
    onToggleRow,
    onToggleAll,
    onManage,
    onViewProduct,
    onCopySku,
    onToggleStatus,
    onArchive,
    onRestore,
  } = e;
  const _ = useRef(null);
  const v = useRef(null);
  const y = rows.length > 0 && rows.every((e) => selected.has(e.id));
  const b = rows.some((e) => selected.has(e.id));
  const x = new Map(products.map((e) => [e.id, e]));
  useEffect(() => {
    if (v.current) {
      v.current.indeterminate = b && !y;
    }
  }, [b, y]);
  useEffect(() => {
    if (_.current) {
      hydrateProductImages(_.current).catch((e) =>
        showToast(
          e instanceof Error ? e.message : "Product image could not be loaded.",
        ),
      );
    }
  }, [rows, selected, sort, direction, archived]);
  const S = (e, t) => (
    <th
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
      ref={_}
      className="table-scroll c-table-scroll catalog-ops-table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Product variants"
    >
      <table className="c-table catalog-ops-table variant-ops-table">
        <thead>
          <tr>
            <th scope="col" className="c-check">
              <input
                ref={v}
                type="checkbox"
                checked={y}
                onChange={(e) => onToggleAll(e.currentTarget.checked)}
                aria-label="Select all visible variants"
              />
            </th>
            {S("product", "Product")}
            {S("name", "Combination")}
            {S("sku", "Variant SKU")}
            {S("price", "Price")}
            {S("stock", "Inventory")}
            {S("status", "Status")}
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const t = x.get(String(e.productId || ""));
            return (
              <tr key={e.id}>
                <td className="c-check">
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={(t) => onToggleRow(e.id, t.currentTarget.checked)}
                    aria-label={`Select ${String(e.name || "")}`}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="c-record-name product-record-name"
                    onClick={() => onViewProduct(e.id)}
                  >
                    {t ? (
                      <OverviewProductThumb product={getProductThumbnail(t)} />
                    ) : null}
                    <span>
                      <strong>{String(t?.name || "Missing product")}</strong>
                      <small>
                        {String(t?.category || "Catalog")}
                        {" · "}
                        {String(t?.brand || "No brand")}
                      </small>
                    </span>
                  </button>
                </td>
                <td>
                  <strong className="catalog-combination">
                    {String(e.name || "")}
                  </strong>
                </td>
                <td>
                  <span className="product-mono">{String(e.sku || "—")}</span>
                </td>
                <td>
                  <strong>{formatCurrency(Number(e.price || 0), 2)}</strong>
                </td>
                <td>
                  <VariantStockMeter row={e} />
                </td>
                <td>
                  <VariantStatusBadge row={e} />
                </td>
                <td className="product-actions-cell">
                  <VariantRowActions
                    row={e}
                    archived={archived}
                    onManage={onManage}
                    onViewProduct={onViewProduct}
                    onCopySku={onCopySku}
                    onToggleStatus={onToggleStatus}
                    onArchive={onArchive}
                    onRestore={onRestore}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
