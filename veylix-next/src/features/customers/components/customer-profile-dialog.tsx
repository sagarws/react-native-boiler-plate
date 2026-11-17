// @ts-nocheck
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { CustomerTimeline } from "@/features/customers/components/customer-timeline";
import {
  customerDateFormatter,
  getCustomerInitials,
  getCustomerOrderStats,
  getCustomerOrders,
} from "@/features/customers/lib/customer-metrics";
import { compactUsdFormatter, integerFormatter } from "@/lib/intl-formatters";
import { buildHref, navigate } from "@/lib/navigation";
import { findRecord } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";

function CustomerProfileSegmentBadge({ value = "New" }) {
  const t = String(value || "New")
    .toLowerCase()
    .replace(/\s+/g, "-");
  return <span className={`customer-segment ${t}`}>{value || "New"}</span>;
}

export function CustomerProfileDialog({
  customerId,
  onClose,
  onEdit,
  onAddNote,
  onActivity,
  onCopyEmail,
}) {
  const o = findRecord("customers", customerId);
  if (!o) return null;
  const s = getCustomerOrderStats(o);
  const c = [...getCustomerOrders(o)].sort((e, t) =>
    String(t.date || "").localeCompare(String(e.date || "")),
  );
  const l = String(o.tags || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const u = s.latest?.date
    ? customerDateFormatter.format(
        new Date(`${String(s.latest.date)}T00:00:00`),
      )
    : "No orders yet";
  const d = o.createdAt
    ? customerDateFormatter.format(new Date(`${String(o.createdAt)}T00:00:00`))
    : "demo workspace";
  const f = Array.isArray(o.customerNotes) ? o.customerNotes : [];
  return (
    <AppDialog
      title={String(o.name || "Customer")}
      onClose={onClose}
      wide
      className="customer-profile-dialog"
    >
      <div className="customer-profile-hero">
        <span className="customer-profile-avatar">
          {getCustomerInitials(o.name)}
        </span>
        <div className="customer-profile-title">
          <div>
            <h2>{String(o.name || "Customer")}</h2>
            <CustomerProfileSegmentBadge value={String(o.segment || "New")} />
            <StatusPill value={String(o.status || "Active")} />
          </div>
          <p>
            {String(o.email || "No email")}
            {" · "}
            {String(o.phone || "No phone")}
          </p>
          <small>
            {"Customer since "}
            {d}
          </small>
        </div>
      </div>
      <div className="customer-profile-metrics">
        <div>
          <span>Orders</span>
          <strong>{integerFormatter.format(s.orders)}</strong>
          <small>{u}</small>
        </div>
        <div>
          <span>Lifetime value</span>
          <strong>{compactUsdFormatter.format(s.spend)}</strong>
          <small>Non-cancelled orders</small>
        </div>
        <div>
          <span>Average order</span>
          <strong>{compactUsdFormatter.format(s.aov)}</strong>
          <small>
            {s.returns}
            {" return · "}
            {s.refunds}
            {" refund request"}
          </small>
        </div>
        <div>
          <span>Marketing</span>
          <strong>{String(o.marketing || "Not subscribed")}</strong>
          <small>
            {String(o.segment || "New")}
            {" segment"}
          </small>
        </div>
      </div>
      <div className="customer-profile-grid">
        <section className="customer-profile-card">
          <div className="customer-profile-section-title">
            <h3>{"Contact & address"}</h3>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onEdit(o.id)}
            >
              Edit
            </button>
          </div>
          <dl className="customer-profile-details">
            <div>
              <dt>Email</dt>
              <dd>{String(o.email || "—")}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{String(o.phone || "—")}</dd>
            </div>
            <div>
              <dt>Company</dt>
              <dd>{String(o.company || "—")}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>
                {[o.city, o.country].filter(Boolean).map(String).join(", ") ||
                  "—"}
              </dd>
            </div>
            <div className="wide">
              <dt>Address</dt>
              <dd>{String(o.address || "—")}</dd>
            </div>
          </dl>
          <div className="customer-tag-list">
            {l.length ? (
              l.map((e) => <span key={e}>{e}</span>)
            ) : (
              <span>No tags</span>
            )}
          </div>
        </section>
        <section className="customer-profile-card">
          <div className="customer-profile-section-title">
            <h3>Merchant notes</h3>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onAddNote(o.id)}
            >
              <Icon name="plus" />
              {" Add note"}
            </button>
          </div>
          {o.notes ? (
            <p className="customer-merchant-note">{String(o.notes)}</p>
          ) : (
            <p className="customer-empty-note">No profile note yet.</p>
          )}
          {f.slice(0, 3).map((e, t) => {
            const n = e.date ? new Date(String(e.date)) : void 0;
            const r =
              n && !Number.isNaN(n.getTime())
                ? customerDateFormatter.format(n)
                : "—";
            return (
              <div key={String(e.id || t)} className="customer-saved-note">
                <strong>{String(e.text || "")}</strong>
                <small>
                  {String(e.author || "Alex Chen")}
                  {" · "}
                  {r}
                </small>
              </div>
            );
          })}
        </section>
      </div>
      <section className="customer-profile-card customer-orders-card">
        <div className="customer-profile-section-title">
          <h3>Order history</h3>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onClose();
              navigate(
                `/commerce/orders?q=${encodeURIComponent(String(o.name || ""))}`,
              );
            }}
          >
            View all orders
          </button>
        </div>
        {c.length ? (
          <div className="customer-order-list">
            {c.slice(0, 5).map((e) => (
              <Link
                key={e.id}
                href={buildHref(
                  `/commerce/orders?q=${encodeURIComponent(String(e.number || ""))}`,
                )}
              >
                <span>
                  <strong>{String(e.number || "")}</strong>
                  <small>
                    {String(e.date || "")}
                    {" · "}
                    {String(e.channel || "Online store")}
                  </small>
                </span>
                <StatusPill value={String(e.status || "")} />
                <strong>
                  {compactUsdFormatter.format(calculateOrderTotal(e))}
                </strong>
              </Link>
            ))}
          </div>
        ) : (
          <p className="customer-empty-note">
            This customer has not placed an order yet.
          </p>
        )}
      </section>
      <section className="customer-profile-card">
        <div className="customer-profile-section-title">
          <h3>Activity timeline</h3>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onActivity(o.id)}
          >
            Full activity
          </button>
        </div>
        <CustomerTimeline row={o} />
      </section>
      <div className="customer-profile-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            onClose();
            navigate(`/commerce/chat?customer=${encodeURIComponent(o.id)}`);
          }}
        >
          <Icon name="chats-circle" />
          {" Open inbox"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onCopyEmail(o.id)}
        >
          <Icon name="copy" />
          {" Copy email"}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => onEdit(o.id)}
        >
          Edit customer
        </button>
      </div>
    </AppDialog>
  );
}
