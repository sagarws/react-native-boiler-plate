// @ts-nocheck
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { modulesById } from "@/config/modules/registry";
import { OrderActivityDialog } from "@/features/orders/components/order-activity-dialog";
import { OrderCancelDialog } from "@/features/orders/components/order-cancel-dialog";
import {
  OrderDetailDialog,
  OrderStatePill,
} from "@/features/orders/components/order-detail-dialog";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { getProductThumbnail } from "@/features/products/lib/product-helpers";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { integerFormatter } from "@/lib/intl-formatters";
import { hydrateProductImages } from "@/lib/media-storage";
import { buildHref, navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";
import {
  calculateOrderTotal,
  updateOrderPaymentStatus,
  updateOrderStatus,
} from "@/lib/store/orders";

const orderListDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatOrderListDate(e) {
  if (!e) return "—";
  const t = new Date(`${String(e)}T12:00:00`);
  return Number.isNaN(t.getTime())
    ? String(e)
    : orderListDateFormatter.format(t);
}

function getOrderListLineItems(e) {
  if (Array.isArray(e.items) && e.items.length) return e.items;
  const t = findRecord("products", e.productId);
  return [
    {
      productId: e.productId,
      quantity: Number(e.quantity || 1),
      unitPrice: Number(t?.price || 0),
    },
  ];
}

function countOrderListUnits(e) {
  return getOrderListLineItems(e).reduce(
    (e, t) => e + Number(t.quantity || 0),
    0,
  );
}

function OrderSummaryCard({ icon, label, value, detail, tone = "green" }) {
  return (
    <div className={`order-summary-card ${tone}`}>
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

function OrderSortableHeader({ label, sortKey, sort, direction, onSort }) {
  const a = sort === sortKey;
  return (
    <th
      scope="col"
      aria-sort={a ? (direction === 1 ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={() => onSort(sortKey)}>
        {label}
        <Icon name={a && direction < 0 ? "arrow-down" : "arrow-up"} />
      </button>
    </th>
  );
}

export function OrdersPage({ initialQuery = "" }) {
  const t = useRef(null);
  const n = modulesById.orders;
  const [r, i] = useState(initialQuery);
  const [a, o] = useState("");
  const [s, c] = useState("");
  const [u, d] = useState("");
  const [f, p] = useState("");
  const [m, h] = useState("");
  const [g, _] = useState(1);
  const [v, y] = useState(1);
  const [b, x] = useState(8);
  const [S, C] = useState(0);
  const [w, T] = useState(null);
  const E = useMemo(() => listRecords("orders"), [S]);
  const D = n.fields.find((e) => e.key === "status")?.options || [];
  const O = n.fields.find((e) => e.key === "payment")?.options || [];
  const k = n.fields.find((e) => e.key === "channel")?.options || [];
  const A = useMemo(() => {
    let e = [...E];
    if (r) {
      const t = r.toLowerCase();
      e = e.filter((e) =>
        [
          ...Object.values(e),
          getRecordLabel("customers", e.customerId),
          getRecordLabel("products", e.productId),
        ]
          .join(" ")
          .toLowerCase()
          .includes(t),
      );
    }
    if (
      (a && (e = e.filter((e) => e.status === a)),
      s && (e = e.filter((e) => String(e.payment || "Pending") === s)),
      u && (e = e.filter((e) => String(e.channel || "Online store") === u)),
      f)
    ) {
      const t = Number(f);
      const n = Math.max(...E.map((e) => Date.parse(String(e.date || "")) || 0));
      if (Number.isFinite(t) && t > 0 && n > 0) {
        e = e.filter(
          (e) => (Date.parse(String(e.date || "")) || 0) >= n - (t - 1) * 864e5,
        );
      }
    }
    if (m) {
      e.sort((e, t) => {
        const n = (e) => {
          if (m === "customer")
            return getRecordLabel("customers", e.customerId);
          if (m === "items") return countOrderListUnits(e);
          if (m === "date") return Date.parse(String(e.date || "")) || 0;
          if (m === "total") return calculateOrderTotal(e);
          const t = e[m];
          return typeof t == "number" ? t : String(t || "");
        };
        const r = n(e);
        const i = n(t);
        return (
          g *
          (typeof r == "number" && typeof i == "number"
            ? r - i
            : String(r).localeCompare(String(i)))
        );
      });
    }
    return e;
  }, [E, r, a, s, u, f, m, g]);
  const j = Math.max(1, Math.ceil(A.length / b));
  const M = Math.min(v, j);
  const N = A.slice((M - 1) * b, M * b);
  const ee = A.length ? (M - 1) * b + 1 : 0;
  const te = Math.min(M * b, A.length);
  const ne = () => C((e) => e + 1);
  const re = (e, t) => {
    e(t);
    y(1);
  };
  const ie = (e) => {
    if (m === e) {
      _((e) => (e === 1 ? -1 : 1));
    } else {
      h(e);
      _(1);
    }
  };
  const ae = (e) => {
    try {
      e();
      ne();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This order could not be updated.",
      );
    }
  };
  const oe = E.filter((e) => e.status !== "Cancelled");
  const se = oe.reduce((e, t) => e + calculateOrderTotal(t), 0);
  const ce = E.filter((e) =>
    ["Unfulfilled", "Processing", "Packed"].includes(String(e.status || "")),
  ).length;
  const le = E.filter((e) =>
    ["Pending", "Failed", "Refund requested"].includes(String(e.payment || "")),
  );
  const ue = new Set(
    listRecords("deliveries")
      .filter((e) =>
        ["Delayed", "Failed", "Delivery attempted"].includes(
          String(e.status || ""),
        ),
      )
      .map((e) => String(e.orderId || "")),
  );
  const de = new Set([
    ...le.map((e) => e.id),
    ...E.filter((e) => e.status === "On hold" || ue.has(e.id)).map((e) => e.id),
  ]);
  useEffect(() => {
    if (t.current) {
      hydrateProductImages(t.current).catch(() => void 0);
    }
  }, [N, S]);
  const fe = () => {
    downloadFile(
      "veylix-orders.csv",
      "﻿" +
        buildCsv(
          A.map((e) => {
            const t = listRecords("deliveries").find((t) => t.orderId === e.id);
            return {
              number: e.number,
              date: e.date,
              customer: getRecordLabel("customers", e.customerId),
              items: countOrderListUnits(e),
              total: calculateOrderTotal(e),
              payment: e.payment,
              fulfillment: e.status,
              channel: e.channel || "Online store",
              delivery: e.deliveryMethod || t?.method || "Standard delivery",
              tracking: t?.tracking || "",
            };
          }),
          [
            "number",
            "date",
            "customer",
            "items",
            "total",
            "payment",
            "fulfillment",
            "channel",
            "delivery",
            "tracking",
          ],
          [
            "Order",
            "Date",
            "Customer",
            "Items",
            "Total",
            "Payment",
            "Fulfillment",
            "Channel",
            "Delivery method",
            "Tracking",
          ],
        ),
    );
    showToast("Filtered orders exported.");
  };
  const pe = async (e) => {
    const t = `#${String(e.number || "")}`;
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(t);
      else {
        const e = document.createElement("textarea");
        e.value = t;
        e.style.position = "fixed";
        e.style.opacity = "0";
        document.body.append(e);
        e.select();
        document.execCommand("copy");
        e.remove();
      }
      showToast("Order number copied.");
    } catch {
      showToast("Order number could not be copied.");
    }
  };
  const me = (e) => {
    const t = {
      Unfulfilled: ["Processing", "Start processing"],
      Processing: ["Packed", "Mark packed"],
      Packed: ["Shipped", "Mark shipped"],
      Shipped: ["Delivered", "Mark delivered"],
    }[String(e.status || "")];
    const n = [
      {
        label: "View order",
        icon: "eye",
        onClick: () =>
          T({
            mode: "detail",
            id: e.id,
          }),
      },
      {
        label: "Edit order",
        icon: "pencil",
        onClick: () =>
          T({
            mode: "edit",
            id: e.id,
          }),
      },
      {
        label: "Copy order number",
        icon: "copy",
        onClick: () => {
          pe(e);
        },
      },
      {
        label: "Activity",
        icon: "history",
        onClick: () =>
          T({
            mode: "activity",
            id: e.id,
          }),
      },
    ];
    if (["Pending", "Failed"].includes(String(e.payment || ""))) {
      n.push({
        label: "Mark paid",
        icon: "wallet",
        onClick: () =>
          ae(() => {
            showToast(
              `#${updateOrderPaymentStatus(e.id, "Paid").number} marked paid.`,
            );
          }),
        separatorBefore: true,
      });
    }
    if (t) {
      n.push({
        label: t[1],
        icon: t[0] === "Shipped" ? "truck" : "check-circle",
        onClick: () =>
          ae(() => {
            const n = updateOrderStatus(e.id, t[0]);
            showToast(`#${n.number} moved to ${n.status}.`);
          }),
        separatorBefore: !["Pending", "Failed"].includes(
          String(e.payment || ""),
        ),
      });
    }
    n.push({
      label: "Fulfillment & tracking",
      icon: "truck",
      onClick: () =>
        navigate(
          `/commerce/fulfillment?q=${encodeURIComponent(String(e.number || ""))}`,
        ),
    });
    if (e.status === "Delivered") {
      n.push({
        label: "Create return",
        icon: "arrow-left",
        onClick: () =>
          navigate(
            `/commerce/returns?q=${encodeURIComponent(String(e.number || ""))}`,
          ),
      });
    }
    if (
      ["Paid", "Partially refunded", "Refund requested"].includes(
        String(e.payment || ""),
      ) &&
      e.status !== "Cancelled"
    ) {
      n.push({
        label: "Refunds",
        icon: "wallet",
        onClick: () =>
          navigate(
            `/commerce/refunds?q=${encodeURIComponent(String(e.number || ""))}`,
          ),
      });
    }
    if (!["Delivered", "Cancelled"].includes(String(e.status || ""))) {
      n.push({
        label: "Cancel order",
        icon: "x",
        danger: true,
        separatorBefore: true,
        onClick: () =>
          T({
            mode: "cancel",
            id: e.id,
          }),
      });
    }
    return n;
  };
  return (
    <div ref={t}>
      <CommercePageHeading
        title="Orders"
        onExport={fe}
        onCreate={() =>
          T({
            mode: "create",
          })
        }
        createLabel="Add order"
      />
      <section className="order-summary-grid" aria-label="Order overview">
        <OrderSummaryCard
          icon="clipboard-text"
          label="Total orders"
          value={integerFormatter.format(E.length)}
          detail={`${integerFormatter.format(oe.length)} active orders`}
        />
        <OrderSummaryCard
          icon="wallet"
          label="Order value"
          value={formatCurrency(se, 2)}
          detail="Excludes cancellations"
          tone="blue"
        />
        <OrderSummaryCard
          icon="package"
          label="To fulfill"
          value={integerFormatter.format(ce)}
          detail={ce ? "Needs an operations step" : "Fulfillment is clear"}
          tone="amber"
        />
        <OrderSummaryCard
          icon="info"
          label="Needs attention"
          value={integerFormatter.format(de.size)}
          detail={
            le.length
              ? `${le.length} payment review${le.length === 1 ? "" : "s"}`
              : de.size
                ? "Delivery review needed"
                : "Nothing urgent"
          }
          tone="red"
        />
      </section>
      <nav className="order-shortcuts" aria-label="Order operations">
        {[
          ["fulfillment", "Fulfillment"],
          ["deliveries", "Deliveries"],
          ["returns", "Returns"],
          ["refunds", "Refunds"],
          ["cancellations", "Cancellations"],
          ["abandoned", "Abandoned checkouts"],
        ].map(([e, t]) => (
          <Link
            key={e}
            className="secondary-button"
            href={buildHref(`/commerce/${e}`)}
          >
            {t}
          </Link>
        ))}
      </nav>
      <section className="glass-card order-filter-card">
        <div className="c-toolbar order-toolbar">
          <label className="c-filter">
            <span className="sr-only">Filter by fulfillment status</span>
            <select
              data-c-filter
              value={a}
              onChange={(e) => re(o, e.currentTarget.value)}
            >
              <option value="">All fulfillment</option>
              {D.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter by payment status</span>
            <select
              data-order-payment
              value={s}
              onChange={(e) => re(c, e.currentTarget.value)}
            >
              <option value="">All payments</option>
              {O.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter by sales channel</span>
            <select
              data-order-channel
              value={u}
              onChange={(e) => re(d, e.currentTarget.value)}
            >
              <option value="">All channels</option>
              {k.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter by order date</span>
            <select
              data-order-date
              value={f}
              onChange={(e) => re(p, e.currentTarget.value)}
            >
              <option value="">All dates</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
          <label className="c-search order-search">
            <Icon name="search" />
            <input
              data-c-search
              type="search"
              placeholder="Search orders, customers..."
              value={r}
              onChange={(e) => re(i, e.currentTarget.value)}
              aria-label="Search orders"
            />
          </label>
        </div>
      </section>
      <section className="glass-card c-resource order-resource">
        <div className="order-list-heading">
          <div>
            <span>ORDER BOOK</span>
            <h2>Orders</h2>
          </div>
          <small>
            {integerFormatter.format(A.length)}
            {" matching orders"}
          </small>
        </div>
        <div id="resource-results">
          <div
            className="table-scroll order-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Order records"
          >
            {A.length ? (
              <table className="c-table order-table">
                <thead>
                  <tr>
                    <OrderSortableHeader
                      label="Order"
                      sortKey="number"
                      sort={m}
                      direction={g}
                      onSort={ie}
                    />
                    <OrderSortableHeader
                      label="Date"
                      sortKey="date"
                      sort={m}
                      direction={g}
                      onSort={ie}
                    />
                    <OrderSortableHeader
                      label="Customer"
                      sortKey="customer"
                      sort={m}
                      direction={g}
                      onSort={ie}
                    />
                    <OrderSortableHeader
                      label="Items"
                      sortKey="items"
                      sort={m}
                      direction={g}
                      onSort={ie}
                    />
                    <OrderSortableHeader
                      label="Total"
                      sortKey="total"
                      sort={m}
                      direction={g}
                      onSort={ie}
                    />
                    <OrderSortableHeader
                      label="Payment"
                      sortKey="payment"
                      sort={m}
                      direction={g}
                      onSort={ie}
                    />
                    <OrderSortableHeader
                      label="Fulfillment"
                      sortKey="status"
                      sort={m}
                      direction={g}
                      onSort={ie}
                    />
                    <th scope="col">Delivery</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {N.map((e) => {
                    const t = findRecord("customers", e.customerId);
                    const n = getOrderListLineItems(e);
                    const r = countOrderListUnits(e);
                    const i = listRecords("deliveries").find(
                      (t) => t.orderId === e.id,
                    );
                    return (
                      <tr key={e.id} data-row-id={e.id}>
                        <td>
                          <button
                            type="button"
                            className="order-number"
                            onClick={() =>
                              T({
                                mode: "detail",
                                id: e.id,
                              })
                            }
                          >
                            <strong>#{String(e.number || "")}</strong>
                            <small>{String(e.channel || "Online store")}</small>
                          </button>
                        </td>
                        <td>
                          <span className="order-date">
                            {formatOrderListDate(e.date)}
                          </span>
                        </td>
                        <td>
                          <div className="order-customer">
                            <strong>
                              {String(
                                t?.name ||
                                  getRecordLabel("customers", e.customerId),
                              )}
                            </strong>
                            <small>
                              {String(
                                t?.email || t?.city || "Customer profile",
                              )}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="order-items-cell">
                            <span className="order-item-thumbs">
                              {n.slice(0, 3).map((e, t) => {
                                const n =
                                  findRecord("products", e.productId) ||
                                  listRecords("products", {
                                    archived: true,
                                  }).find((t) => t.id === e.productId);
                                return n ? (
                                  <OverviewProductThumb
                                    key={`${String(e.productId)}-${t}`}
                                    product={getProductThumbnail(n)}
                                  />
                                ) : (
                                  <span
                                    key={`fallback-${t}`}
                                    className="order-item-fallback"
                                  >
                                    <Icon name="package" />
                                  </span>
                                );
                              })}
                            </span>
                            <span>
                              <strong>
                                {integerFormatter.format(r)}
                                {" item"}
                                {r === 1 ? "" : "s"}
                              </strong>
                              <small>
                                {String(
                                  n[0]
                                    ? getRecordLabel("products", n[0].productId)
                                    : "No line items",
                                )}
                                {n.length > 1 ? ` +${n.length - 1} more` : ""}
                              </small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <strong className="order-total">
                            {formatCurrency(calculateOrderTotal(e), 2)}
                          </strong>
                        </td>
                        <td>
                          <OrderStatePill value={e.payment} type="payment" />
                        </td>
                        <td>
                          <OrderStatePill value={e.status} />
                        </td>
                        <td>
                          {e.status === "Cancelled" ? (
                            <div className="order-delivery-cell muted">
                              <strong>Not shipping</strong>
                              <small>Order cancelled</small>
                            </div>
                          ) : i ? (
                            <div className="order-delivery-cell">
                              <strong>
                                {String(
                                  i.milestone ||
                                    i.status ||
                                    e.deliveryMethod ||
                                    "Delivery",
                                )}
                              </strong>
                              <small>
                                {String(
                                  i.tracking || i.courier || "Tracking pending",
                                )}
                              </small>
                            </div>
                          ) : (
                            <div className="order-delivery-cell">
                              <strong>
                                {String(
                                  e.deliveryMethod || "Standard delivery",
                                )}
                              </strong>
                              <small>
                                {e.status === "Delivered"
                                  ? "Delivery completed"
                                  : "Tracking not assigned"}
                              </small>
                            </div>
                          )}
                        </td>
                        <td className="order-actions-cell">
                          <RowActionsMenu
                            label={`order ${String(e.number || "")}`}
                            actions={me(e)}
                            triggerClassName="order-row-menu"
                            panelClassName="order-row-menu-panel"
                            estimatedHeight={440}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="c-empty">
                <Icon name="basket" />
                <h3>
                  {r || a || s || u || f
                    ? "No orders match these filters"
                    : "No orders yet"}
                </h3>
                <p>
                  {r || a || s || u || f
                    ? "Try another search or clear a filter."
                    : "New orders will appear here."}
                </p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {ee}–{te}
              {" of "}
              {A.length}
              {" orders"}
            </span>
            <label>
              {"Per page "}
              <select
                data-c-page-size
                value={b}
                onChange={(e) => {
                  x(Number(e.currentTarget.value));
                  y(1);
                }}
              >
                <option value={8}>8</option>
                <option value={16}>16</option>
                <option value={32}>32</option>
              </select>
            </label>
            <div>
              <button
                type="button"
                className="secondary-button"
                disabled={M === 1}
                onClick={() => y(Math.max(1, M - 1))}
              >
                Previous
              </button>
              <span>
                {M}
                {" / "}
                {j}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={M === j}
                onClick={() => y(Math.min(j, M + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {w?.mode === "create" ? (
        <ResourceRecordDialog
          module={n}
          mode="create"
          onClose={() => T(null)}
          onChanged={ne}
        />
      ) : null}
      {w?.mode === "edit" ? (
        <ResourceRecordDialog
          module={n}
          mode="edit"
          recordId={w.id}
          onClose={() => T(null)}
          onChanged={ne}
        />
      ) : null}
      {w?.mode === "detail" ? (
        <OrderDetailDialog
          orderId={w.id}
          onClose={() => T(null)}
          onEdit={(e) =>
            T({
              mode: "edit",
              id: e,
            })
          }
          onRefresh={ne}
        />
      ) : null}
      {w?.mode === "activity" ? (
        <OrderActivityDialog orderId={w.id} onClose={() => T(null)} />
      ) : null}
      {w?.mode === "cancel" ? (
        <OrderCancelDialog
          orderId={w.id}
          onClose={() => T(null)}
          onConfirm={() =>
            ae(() => {
              const e = updateOrderStatus(w.id, "Cancelled");
              T(null);
              showToast(`#${e.number} cancelled.`);
            })
          }
        />
      ) : null}
    </div>
  );
}
