// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { PaymentLinkStatusPill } from "@/features/payments/components/payment-link-status-pill";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { findRecord } from "@/lib/store/core";

export function PaymentLinkDetailDialog({ id, onClose, onEdit }) {
  const r = findRecord("payment-links", id);
  if (!r) return null;
  const i = r.orderId ? findRecord("orders", String(r.orderId || "")) : void 0;
  const a = `https://example.com/pay/${encodeURIComponent(r.id)}`;
  const o = async () => {
    try {
      await navigator.clipboard.writeText(a);
      showToast("Demo payment URL copied.");
    } catch {
      showToast("Copy is unavailable in this browser.");
    }
  };
  return (
    <AppDialog
      title={String(r.name || "Payment link")}
      onClose={onClose}
      wide
      className="payment-detail-dialog"
    >
      <div className="payment-link-detail-hero">
        <span>
          <Icon name="share" />
        </span>
        <div>
          <small>
            {String(r.status || "")}
            {" · "}
            {String(r.currency || "USD")}
          </small>
          <h2>{formatCurrency(Number(r.amount || 0), 2)}</h2>
          <p>{String(r.description || "Payment request")}</p>
        </div>
        <PaymentLinkStatusPill value={String(r.status || "Draft")} />
      </div>
      <div className="payment-link-detail-grid">
        <div>
          <small>Recipient</small>
          <strong>{String(r.recipient || "No recipient")}</strong>
        </div>
        <div>
          <small>Order</small>
          <strong>{String(i?.number || "Standalone request")}</strong>
        </div>
        <div>
          <small>Uses</small>
          <strong>{`${Number(r.uses || 0)} / ${Number(r.maxUses || 1)}`}</strong>
        </div>
        <div>
          <small>Expires</small>
          <strong>{String(r.expires || "No expiry")}</strong>
        </div>
      </div>
      <section className="payment-link-url">
        <small>Demo checkout URL</small>
        <code>{a}</code>
        <p>
          Theme demo only. Connect a verified payment backend before accepting
          real payments.
        </p>
      </section>
      {r.notes ? (
        <section className="payment-link-note">
          <strong>Internal note</strong>
          <p>{String(r.notes)}</p>
        </section>
      ) : null}
      <div className="button-row payment-detail-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => void o()}
        >
          Copy demo URL
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            onClose();
            onEdit(id);
          }}
        >
          Edit link
        </button>
      </div>
    </AppDialog>
  );
}
