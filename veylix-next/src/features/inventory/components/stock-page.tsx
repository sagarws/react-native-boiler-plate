// @ts-nocheck
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { TablePagination } from "@/components/ui/table-pagination";
import { modulesById } from "@/config/modules/registry";
import { InventoryAdjustDialog } from "@/features/inventory/components/inventory-adjust-dialog";
import { InventoryDetailDialog } from "@/features/inventory/components/inventory-detail-dialog";
import { InventoryOperationDialog } from "@/features/inventory/components/inventory-operation-dialog";
import {
  getActiveWarehouses,
  getProductStockLevels,
} from "@/features/inventory/lib/stock-levels";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatCurrency, formatNumber } from "@/lib/format";
import { hydrateProductImages } from "@/lib/media-storage";
import { buildHref, navigate } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";

const stockPageIconMap = {
  tee: "t-shirt",
  mug: "coffee",
  bottle: "thermometer",
};

function StockProductThumb({ row }) {
  const t = Array.isArray(row.mediaIds) ? row.mediaIds : [];
  return (
    <OverviewProductThumb
      product={{
        mediaId: t.length ? String(t[0] || "") : void 0,
        icon:
          stockPageIconMap[String(row.image || "")] || String(row.image || ""),
      }}
    />
  );
}

function InventoryQuantity({ value, kind = "" }) {
  return (
    <span className={`inventory-quantity ${kind}`.trim()}>
      <strong>{formatNumber(value)}</strong>
      <small>units</small>
    </span>
  );
}

function InventoryStatusPill({ value }) {
  return (
    <span
      className={`inventory-status ${value === "Healthy" ? "green" : value === "Low stock" ? "amber" : value === "Out of stock" ? "red" : "blue"}`}
    >
      <i />
      {value}
    </span>
  );
}

function InventorySummaryCard({ icon, label, value, detail, tone = "green" }) {
  return (
    <div className={`inventory-summary-card ${tone}`}>
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </div>
  );
}

export function StockPage({ initialQuery = "" }) {
  const t = modulesById.stock;
  const n = useRef(null);
  const [r, i] = useState(initialQuery);
  const [a, o] = useState("");
  const [s, c] = useState("");
  const [u, d] = useState("name");
  const [f, p] = useState(1);
  const [m, h] = useState(1);
  const [g, _] = useState(8);
  const [v, y] = useState(0);
  const [b, x] = useState(null);
  const [S, C] = useState(null);
  const [w, T] = useState(null);
  const E = useMemo(() => listRecords("products"), [v]);
  const D = useMemo(() => getActiveWarehouses(), [v]);
  const O = useMemo(() => {
    let e = E.map((e) => ({
      row: e,
      metrics: getProductStockLevels(e, s),
    }));
    if (r) {
      const t = r.toLowerCase();
      e = e.filter(({ row }) =>
        [row.name, row.sku, row.category, row.brand]
          .join(" ")
          .toLowerCase()
          .includes(t),
      );
    }
    if (a) {
      e = e.filter(({ metrics }) => metrics.status === a);
    }
    if (s) {
      e = e.filter(({ metrics }) => metrics.onHand > 0 || metrics.incoming > 0);
    }
    const t = (e) =>
      u === "name"
        ? String(e.row.name || "")
        : u === "sku"
          ? String(e.row.sku || "")
          : u === "status"
            ? e.metrics.status
            : u === "onHand"
              ? e.metrics.onHand
              : u === "committed"
                ? e.metrics.committed
                : u === "incoming"
                  ? e.metrics.incoming
                  : u === "available"
                    ? e.metrics.available
                    : e.metrics.threshold;
    e.sort((e, n) => {
      const r = t(e);
      const i = t(n);
      return (
        f *
        (typeof r == "number" && typeof i == "number"
          ? r - i
          : String(r || "").localeCompare(String(i || "")))
      );
    });
    return e;
  }, [E, r, a, s, u, f]);
  const k = Math.max(1, Math.ceil(O.length / g));
  const A = Math.min(m, k);
  const j = O.slice((A - 1) * g, A * g);
  const M = useMemo(() => E.map((e) => getProductStockLevels(e, s)), [E, s]);
  const N = M.reduce((e, t) => e + t.onHand, 0);
  const ee = M.reduce((e, t) => e + t.committed, 0);
  const te = M.reduce((e, t) => e + t.incoming, 0);
  const ne = M.reduce((e, t) => e + t.available, 0);
  const re = M.reduce((e, t) => e + t.value, 0);
  const ie = M.filter((e) => e.status === "Low stock").length;
  const ae = M.filter((e) => e.status === "Out of stock").length;
  const oe = () => y((e) => e + 1);
  useEffect(() => {
    if (n.current) {
      hydrateProductImages(n.current).catch((e) =>
        showToast(
          e instanceof Error ? e.message : "Product image could not be loaded.",
        ),
      );
    }
  }, [j, v]);
  const se = (e) => {
    p((t) => (u === e && t === 1 ? -1 : 1));
    d(e);
  };
  const ce = () => {
    downloadFile(
      "veylix-inventory.csv",
      "﻿" +
        buildCsv(
          O.map(({ row, metrics }) => ({
            name: row.name,
            sku: row.sku,
            location: s
              ? String(D.find((e) => e.id === s)?.name || "Selected location")
              : "All locations",
            onHand: metrics.onHand,
            committed: metrics.committed,
            incoming: metrics.incoming,
            available: metrics.available,
            reorderPoint: metrics.threshold,
            status: metrics.status,
            inventoryValue: metrics.value.toFixed(2),
          })),
          [
            "name",
            "sku",
            "location",
            "onHand",
            "committed",
            "incoming",
            "available",
            "reorderPoint",
            "status",
            "inventoryValue",
          ],
          [
            "Product",
            "SKU",
            "Location",
            "On hand",
            "Committed",
            "Incoming",
            "Available to sell",
            "Reorder point",
            "Status",
            "Inventory cost value",
          ],
        ),
    );
    showToast("Filtered inventory exported.");
  };
  const le = (e, t) => (
    <th
      scope="col"
      aria-sort={u === t ? (f === 1 ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={() => se(t)}>
        {e}
        <Icon name={u === t && f < 0 ? "arrow-down" : "arrow-up"} />
      </button>
    </th>
  );
  return (
    <div ref={n}>
      <CommercePageHeading
        title={t.title}
        onExport={ce}
        actions={
          <Fragment>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                T({
                  kind: "transfer",
                })
              }
            >
              <Icon name="truck" />
              {" New transfer"}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                T({
                  kind: "replenishment",
                })
              }
            >
              <Icon name="plus" />
              {" Replenish stock"}
            </button>
          </Fragment>
        }
      />
      <section
        className="inventory-summary-grid"
        aria-label="Inventory overview"
      >
        <InventorySummaryCard
          icon="warehouse"
          label="On hand"
          value={formatNumber(N)}
          detail={`${s ? String(D.find((e) => e.id === s)?.name || "Selected location") : "All locations"} · ${formatNumber(ee)} committed`}
        />
        <InventorySummaryCard
          icon="check-circle"
          label="Available to sell"
          value={formatNumber(ne)}
          detail={ne ? "After current commitments" : "No sellable units"}
          tone="blue"
        />
        <InventorySummaryCard
          icon="truck"
          label="Incoming stock"
          value={formatNumber(te)}
          detail={
            te ? "Confirmed purchase orders" : "No confirmed incoming units"
          }
          tone="amber"
        />
        <InventorySummaryCard
          icon="wallet"
          label="Inventory cost value"
          value={formatCurrency(re, 2)}
          detail={`${ie} low stock · ${ae} out of stock`}
          tone={ae ? "red" : ie ? "amber" : "green"}
        />
      </section>
      <nav
        className="resource-shortcuts inventory-shortcuts"
        aria-label="Inventory management pages"
      >
        {[
          ["warehouses", "Warehouses"],
          ["transfers", "Transfers"],
          ["replenishment", "Replenishment"],
          ["adjustments", "Adjustments"],
          ["suppliers", "Suppliers"],
        ].map(([e, t]) => (
          <Link
            key={e}
            className="secondary-button"
            href={buildHref(`/commerce/${e}`)}
          >
            {t}
            <Icon name="arrow-right" />
          </Link>
        ))}
      </nav>
      <section className="glass-card inventory-filter-card">
        <div className="c-toolbar inventory-toolbar">
          <label className="c-filter">
            <span className="sr-only">Filter by stock health</span>
            <select
              value={a}
              onChange={(e) => {
                o(e.currentTarget.value);
                h(1);
              }}
            >
              <option value="">All stock statuses</option>
              {["Healthy", "Low stock", "Out of stock", "Draft"].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter by warehouse</span>
            <select
              value={s}
              onChange={(e) => {
                c(e.currentTarget.value);
                h(1);
              }}
            >
              <option value="">All locations</option>
              {D.map((e) => (
                <option key={e.id} value={e.id}>
                  {String(e.name || "")}
                </option>
              ))}
            </select>
          </label>
          <label className="c-search inventory-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search products or SKU..."
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                h(1);
              }}
              aria-label="Search inventory"
            />
          </label>
        </div>
      </section>
      <section className="glass-card c-resource inventory-resource">
        <div className="inventory-list-heading">
          <div>
            <span>INVENTORY CONTROL</span>
            <h2>{"Stock & availability"}</h2>
            <p>
              See what is on hand, committed to orders and arriving from
              suppliers.
            </p>
          </div>
          <small>
            {formatNumber(O.length)}
            {" matching products"}
          </small>
        </div>
        <div id="resource-results">
          <div
            className="table-scroll inventory-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Inventory records"
          >
            {O.length ? (
              <table className="c-table inventory-table">
                <thead>
                  <tr>
                    {le("Product", "name")}
                    {le("SKU", "sku")}
                    {le(s ? "Location stock" : "On hand", "onHand")}
                    {le("Committed", "committed")}
                    {le("Incoming", "incoming")}
                    {le("Available", "available")}
                    {le("Reorder point", "threshold")}
                    <th scope="col">Locations</th>
                    {le("Status", "status")}
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {j.map(({ row, metrics }) => (
                    <tr key={row.id} data-row-id={row.id}>
                      <td>
                        <button
                          type="button"
                          className="c-record-name inventory-product-name"
                          onClick={() => x(row.id)}
                        >
                          <StockProductThumb row={row} />
                          <span>
                            <strong>{String(row.name || "")}</strong>
                            <small>
                              {String(row.category || "Uncategorized")}
                              {" · "}
                              {String(row.brand || "No brand")}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="product-mono">
                          {String(row.sku || "—")}
                        </span>
                      </td>
                      <td>
                        <InventoryQuantity value={metrics.onHand} />
                      </td>
                      <td>
                        <InventoryQuantity
                          value={metrics.committed}
                          kind={metrics.committed ? "reserved" : ""}
                        />
                      </td>
                      <td>
                        <InventoryQuantity
                          value={metrics.incoming}
                          kind={metrics.incoming ? "incoming" : ""}
                        />
                      </td>
                      <td>
                        <InventoryQuantity
                          value={metrics.available}
                          kind={
                            metrics.available <= metrics.threshold
                              ? "attention"
                              : "sellable"
                          }
                        />
                      </td>
                      <td>
                        <span className="inventory-threshold">
                          {formatNumber(metrics.threshold)}
                        </span>
                      </td>
                      <td>
                        <div className="inventory-locations">
                          {D.filter((e) => !s || e.id === s).map((e) => (
                            <span key={e.id} title={String(e.name || "")}>
                              <strong>{String(e.code || e.name || "")}</strong>
                              <small>
                                {formatNumber(
                                  Number(metrics.locations[e.id] || 0),
                                )}
                              </small>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <InventoryStatusPill value={metrics.status} />
                      </td>
                      <td className="inventory-actions-cell">
                        <RowActionsMenu
                          label={String(row.name || "product")}
                          actions={[
                            {
                              label: "Inventory details",
                              icon: "eye",
                              onClick: () => x(row.id),
                            },
                            {
                              label: "Adjust stock",
                              icon: "pencil",
                              onClick: () => C(row.id),
                            },
                            {
                              label: "Create transfer",
                              icon: "truck",
                              onClick: () =>
                                T({
                                  kind: "transfer",
                                  productId: row.id,
                                }),
                            },
                            {
                              label: "Create replenishment",
                              icon: "package",
                              onClick: () =>
                                T({
                                  kind: "replenishment",
                                  productId: row.id,
                                }),
                            },
                            {
                              label: "Adjustment history",
                              icon: "history",
                              onClick: () =>
                                navigate(
                                  `/commerce/adjustments?q=${encodeURIComponent(String(row.sku || row.name || ""))}`,
                                ),
                            },
                            {
                              label: "Manage product",
                              icon: "shopping-bag",
                              separatorBefore: true,
                              onClick: () =>
                                navigate(
                                  `/commerce/products/edit?id=${encodeURIComponent(row.id)}`,
                                ),
                            },
                          ]}
                          panelClassName="inventory-row-menu-panel"
                          estimatedHeight={330}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="c-empty">
                <Icon name="package" />
                <h3>No inventory matches these filters</h3>
                <p>Try another search, stock status or location.</p>
              </div>
            )}
          </div>
          <TablePagination
            total={O.length}
            page={A}
            pages={k}
            size={g}
            onSizeChange={(e) => {
              _(e);
              h(1);
            }}
            onPrevious={() => h(Math.max(1, A - 1))}
            onNext={() => h(Math.min(k, A + 1))}
          />
        </div>
      </section>
      {b ? (
        <InventoryDetailDialog
          productId={b}
          onClose={() => x(null)}
          onAdjust={() => {
            const e = b;
            x(null);
            C(e);
          }}
          onTransfer={() => {
            const e = b;
            x(null);
            T({
              kind: "transfer",
              productId: e,
            });
          }}
          onReplenish={() => {
            const e = b;
            x(null);
            T({
              kind: "replenishment",
              productId: e,
            });
          }}
          onHistory={() => {
            const e = E.find((e) => e.id === b);
            if (e) {
              navigate(
                `/commerce/adjustments?q=${encodeURIComponent(String(e.sku || e.name || ""))}`,
              );
            }
          }}
        />
      ) : null}
      {S
        ? (() => {
            const e = E.find((e) => e.id === S);
            return e ? (
              <InventoryAdjustDialog
                row={e}
                onClose={() => C(null)}
                onChanged={oe}
              />
            ) : null;
          })()
        : null}
      {w ? (
        <InventoryOperationDialog
          kind={w.kind}
          productId={w.productId}
          onClose={() => T(null)}
          onChanged={oe}
        />
      ) : null}
    </div>
  );
}
