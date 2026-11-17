// @ts-nocheck
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { getProductThumbnail } from "@/features/products/lib/product-helpers";
import { formatCurrency } from "@/lib/format";
import { hydrateProductImages } from "@/lib/media-storage";
import { navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";

const orderDialogDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatOrderDialogDate(e) {
  if (!e) return "—";
  const t = new Date(`${String(e)}T12:00:00`);
  return Number.isNaN(t.getTime())
    ? String(e)
    : orderDialogDateFormatter.format(t);
}

function getOrderDialogLineItems(e) {
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

function countOrderDialogUnits(e) {
  return getOrderDialogLineItems(e).reduce(
    (e, t) => e + Number(t.quantity || 0),
    0,
  );
}

export function OrderStatePill({ value, type = "fulfillment" }) {
  const n = String(value || (type === "payment" ? "Pending" : "Unfulfilled"));
  const r =
    /paid|delivered/i.test(n) && !/refund/i.test(n)
      ? "green"
      : /processing|packed|shipped|pending|requested|partial/i.test(n)
        ? "amber"
        : /failed|cancel|hold/i.test(n)
          ? "red"
          : "blue";
  return (
    <span className={`order-state ${r}`}>
      <i />
      {n}
    </span>
  );
}

function OrderFulfillmentTimeline({ row }) {
  if (row.status === "Cancelled")
    return (
      <div className="order-timeline cancelled">
        <span>
          <Icon name="x" />
        </span>
        <strong>Order cancelled</strong>
        <small>No further fulfillment steps are expected.</small>
      </div>
    );
  const t = ["Processing", "Packed", "Shipped", "Delivered"];
  const n =
    row.status === "Unfulfilled" || row.status === "On hold"
      ? -1
      : t.indexOf(String(row.status || ""));
  return (
    <div className="order-timeline">
      {t.map((e, t) => (
        <div key={e} className={t < n ? "complete" : t === n ? "current" : ""}>
          <span>{t < n ? <Icon name="check" /> : t + 1}</span>
          <strong>{e}</strong>
        </div>
      ))}
    </div>
  );
}

export function OrderDetailDialog({ orderId, onClose, onEdit, onRefresh }) {
  const i = useRef(null);
  const a =
    findRecord("orders", orderId) ||
    listRecords("orders", {
      archived: true,
    }).find((t) => t.id === orderId);
  if (
    (useEffect(() => {
      if (i.current) {
        hydrateProductImages(i.current).catch(() => void 0);
      }
    }, [orderId, onRefresh]),
    !a)
  )
    return null;
  const o = findRecord("customers", a.customerId);
  const s = listRecords("deliveries").find((t) => t.orderId === orderId);
  const c = listRecords("fulfillment").find((t) => t.orderId === orderId);
  const u = getOrderDialogLineItems(a);
  const d = u.reduce(
    (e, t) => e + Number(t.quantity || 0) * Number(t.unitPrice || 0),
    0,
  );
  const f =
    ["Paid", "Partially refunded", "Refund requested"].includes(
      String(a.payment || ""),
    ) && a.status !== "Cancelled";
  return (
    <AppDialog
      title={`Order #${String(a.number || "")}`}
      onClose={onClose}
      wide
      className="order-detail-dialog"
    >
      <div ref={i}>
        <div className="order-detail-status">
          <div>
            <OrderStatePill value={a.status} />
            <OrderStatePill value={a.payment} type="payment" />
          </div>
          <small>
            {"Placed "}
            {formatOrderDialogDate(a.date)}
            {" · "}
            {String(a.channel || "Online store")}
          </small>
        </div>
        <OrderFulfillmentTimeline row={a} />
        <div className="order-detail-grid">
          <section className="order-detail-panel">
            <div className="order-detail-panel-heading">
              <span>
                <Icon name="package" />
              </span>
              <div>
                <strong>Order items</strong>
                <small>
                  {countOrderDialogUnits(a)}
                  {" total units"}
                </small>
              </div>
            </div>
            <div className="order-detail-items">
              {u.map((e, t) => {
                const n =
                  findRecord("products", e.productId) ||
                  listRecords("products", {
                    archived: true,
                  }).find((t) => t.id === e.productId);
                const r = Number(e.quantity || 0);
                const i = Number(e.unitPrice || 0);
                return (
                  <div
                    key={`${String(e.productId || "item")}-${t}`}
                    className="order-detail-item"
                  >
                    {n ? (
                      <OverviewProductThumb product={getProductThumbnail(n)} />
                    ) : (
                      <span className="order-item-fallback">
                        <Icon name="package" />
                      </span>
                    )}
                    <div>
                      <strong>
                        {String(
                          n?.name || getRecordLabel("products", e.productId),
                        )}
                      </strong>
                      <small>
                        {String(n?.sku || "Archived product")}
                        {" · Qty "}
                        {r}
                      </small>
                    </div>
                    <strong>{formatCurrency(r * i, 2)}</strong>
                  </div>
                );
              })}
            </div>
            <div className="order-totals">
              <div>
                <span>Subtotal</span>
                <strong>{formatCurrency(d, 2)}</strong>
              </div>
              <div>
                <span>Shipping</span>
                <strong>{formatCurrency(Number(a.shipping || 0), 2)}</strong>
              </div>
              <div>
                <span>Tax</span>
                <strong>{formatCurrency(Number(a.tax || 0), 2)}</strong>
              </div>
              <div>
                <span>Discount</span>
                <strong>−{formatCurrency(Number(a.discount || 0), 2)}</strong>
              </div>
              <div className="total">
                <span>Total</span>
                <strong>{formatCurrency(calculateOrderTotal(a), 2)}</strong>
              </div>
            </div>
          </section>
          <div className="order-detail-side">
            <section className="order-detail-panel">
              <div className="order-detail-panel-heading">
                <span>
                  <Icon name="users" />
                </span>
                <div>
                  <strong>Customer</strong>
                  <small>{String(o?.segment || "Customer")}</small>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Name</dt>
                  <dd>
                    {String(
                      o?.name || getRecordLabel("customers", a.customerId),
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{String(o?.email || "—")}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{String(o?.phone || "—")}</dd>
                </div>
                <div>
                  <dt>Ship to</dt>
                  <dd>{String(a.shippingAddress || o?.city || "—")}</dd>
                </div>
              </dl>
            </section>
            <section className="order-detail-panel">
              <div className="order-detail-panel-heading">
                <span>
                  <Icon name="truck" />
                </span>
                <div>
                  <strong>Delivery</strong>
                  <small>
                    {String(a.deliveryMethod || "Standard delivery")}
                  </small>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {String(
                      s?.milestone || s?.status || c?.status || a.status || "—",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Courier</dt>
                  <dd>{String(s?.courier || c?.carrier || "Not assigned")}</dd>
                </div>
                <div>
                  <dt>Tracking</dt>
                  <dd>
                    {String(s?.tracking || c?.tracking || "Not assigned")}
                  </dd>
                </div>
                <div>
                  <dt>ETA</dt>
                  <dd>{formatOrderDialogDate(s?.eta || c?.eta)}</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
        {a.notes ? (
          <div className="order-note">
            <strong>Order note</strong>
            <p>{String(a.notes)}</p>
          </div>
        ) : null}
        <div className="store-tool-dialog-actions order-detail-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onClose();
              onEdit(orderId);
            }}
          >
            <Icon name="pencil" />
            {" Edit order"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onClose();
              navigate(
                `/commerce/fulfillment?q=${encodeURIComponent(String(a.number || ""))}`,
              );
            }}
          >
            <Icon name="truck" />
            {" Fulfillment"}
          </button>
          {f ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                onClose();
                navigate(
                  `/commerce/refunds?q=${encodeURIComponent(String(a.number || ""))}`,
                );
              }}
            >
              <Icon name="wallet" />
              {" Refunds"}
            </button>
          ) : null}
        </div>
      </div>
    </AppDialog>
  );
}
