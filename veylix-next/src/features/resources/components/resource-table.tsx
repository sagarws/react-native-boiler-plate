// @ts-nocheck
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons/icon";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { ResourceCellValue } from "@/features/resources/components/resource-cell-value";
import { showToast } from "@/lib/events";
import { hydrateProductImages } from "@/lib/media-storage";

function resourceTableColumnLabel(e, t) {
  return (
    e.fields.find((e) => e.key === t)?.label ||
    {
      total: "Total",
      net: "Vendor net",
    }[t] ||
    t
  );
}

const productIconAliases = {
  tee: "t-shirt",
  mug: "coffee",
  bottle: "thermometer",
};

function ResourceRowThumbnail(e) {
  const t = Array.isArray(e.mediaIds) ? e.mediaIds : [];
  return (
    <OverviewProductThumb
      product={{
        mediaId: t.length ? String(t[0] || "") : void 0,
        icon:
          productIconAliases[String(e.image || "")] || String(e.image || ""),
      }}
    />
  );
}

export function ResourceTable({
  module,
  sourceModule,
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
  onWebhookPayload,
}) {
  const h = sourceModule || module;
  const g = useRef(null);
  const _ = useRef(null);
  const v = rows.length > 0 && rows.every((e) => selected.has(e.id));
  const y = rows.some((e) => selected.has(e.id));
  useEffect(() => {
    if (_.current) {
      _.current.indeterminate = y && !v;
    }
  }, [y, v]);
  useEffect(() => {
    if (module.id !== "products" && module.id !== "stock") return;
    const t = g.current;
    if (t) {
      hydrateProductImages(t).catch((e) =>
        showToast(
          e instanceof Error ? e.message : "Product image could not be loaded.",
        ),
      );
    }
  }, [module.id, rows, selected, sort, direction, archived]);
  return (
    <div
      ref={g}
      className="table-scroll c-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={`${module.title} records`}
    >
      <table className="c-table">
        <thead>
          <tr>
            {module.readonly ? null : (
              <th scope="col" className="c-check">
                <input
                  ref={_}
                  type="checkbox"
                  data-c-select-all
                  checked={v}
                  onChange={(e) => onToggleAll(e.currentTarget.checked)}
                  aria-label="Select all visible records"
                />
              </th>
            )}
            {module.columns.map((e) => (
              <th
                key={e}
                scope="col"
                aria-sort={
                  sort === e
                    ? direction === 1
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  data-c-action="sort"
                  data-key={e}
                  onClick={() => onSort(e)}
                >
                  {resourceTableColumnLabel(h, e)}
                  <Icon
                    name={
                      sort === e && direction < 0 ? "arrow-down" : "arrow-up"
                    }
                  />
                </button>
              </th>
            ))}
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const n = String(t.name || t.number || t.code || t.id);
            const i = module.readonly
              ? "View"
              : archived
                ? "Restore"
                : module.editor === "stock"
                  ? "Adjust"
                  : "Edit";
            return (
              <tr key={t.id} data-row-id={t.id}>
                {module.readonly ? null : (
                  <td className="c-check">
                    <input
                      type="checkbox"
                      data-c-select={t.id}
                      checked={selected.has(t.id)}
                      onChange={(e) =>
                        onToggleRow(t.id, e.currentTarget.checked)
                      }
                      aria-label={`Select ${n}`}
                    />
                  </td>
                )}
                {module.columns.map((n, r) => (
                  <td key={n}>
                    {r === 0 ? (
                      <button
                        type="button"
                        className="c-record-name"
                        data-c-action="detail"
                        data-id={t.id}
                        onClick={() => onDetail(t.id)}
                      >
                        {module.id === "stock" ? ResourceRowThumbnail(t) : null}
                        <span>
                          <ResourceCellValue module={h} row={t} fieldKey={n} />
                        </span>
                      </button>
                    ) : (
                      <ResourceCellValue module={h} row={t} fieldKey={n} />
                    )}
                  </td>
                ))}
                <td>
                  <div className="c-row-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      data-c-action={
                        module.readonly
                          ? "detail"
                          : archived
                            ? "restore"
                            : "edit"
                      }
                      data-id={t.id}
                      onClick={() =>
                        module.readonly
                          ? onDetail(t.id)
                          : archived
                            ? onRestore(t.id)
                            : onEdit(t.id)
                      }
                    >
                      {i}
                    </button>
                    {module.id === "webhooks" && onWebhookPayload ? (
                      <button
                        type="button"
                        className="secondary-button"
                        data-c-action="webhook-preview"
                        data-id={t.id}
                        onClick={() => onWebhookPayload(t.id)}
                      >
                        Payload
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
