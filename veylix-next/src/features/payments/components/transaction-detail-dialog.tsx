// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { TransactionStatusPill } from "@/features/payments/components/transaction-status-pills";
import {
  getSignedTransactionAmount,
  getTransactionNetAmount,
} from "@/features/payments/lib/payment-metrics";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";

export function TransactionDetailDialog({ id, onClose, onMarkReviewed }) {
  const r = findRecord("transactions", id);
  if (!r) return null;
  const i = findRecord("orders", String(r.orderId || ""));
  const a = i ? findRecord("customers", String(i.customerId || "")) : void 0;
  const o = listRecords("settlements").find(
    (e) => e.reference === r.settlementRef,
  );
  const s = async () => {
    try {
      await navigator.clipboard.writeText(String(r.reference || ""));
      showToast("Payment reference copied.");
    } catch {
      showToast("Copy is unavailable in this browser.");
    }
  };
  return (
    <AppDialog
      title={String(r.reference || "Transaction")}
      onClose={onClose}
      wide
      className="payment-detail-dialog"
    >
      <div className="payment-detail-hero">
        <span>
          <Icon name={r.provider === "Offline" ? "storefront" : "wallet"} />
        </span>
        <div>
          <small>
            {String(r.provider || "")}
            {" · "}
            {String(r.type || "")}
          </small>
          <h2>{formatCurrency(getSignedTransactionAmount(r), 2)}</h2>
          <p>
            {String(r.method || "Payment method")}
            {" · "}
            {String(r.currency || "USD")}
          </p>
        </div>
        <TransactionStatusPill value={String(r.status || "Pending")} />
      </div>
      <div className="payment-detail-metrics">
        <div>
          <small>Gross</small>
          <strong>{formatCurrency(getSignedTransactionAmount(r), 2)}</strong>
        </div>
        <div>
          <small>Provider fee</small>
          <strong>{formatCurrency(Number(r.fee || 0), 2)}</strong>
        </div>
        <div>
          <small>Net</small>
          <strong>{formatCurrency(getTransactionNetAmount(r), 2)}</strong>
        </div>
        <div>
          <small>Risk</small>
          <strong>{String(r.risk || "Normal")}</strong>
        </div>
      </div>
      <div className="payment-detail-grid">
        <section className="payment-detail-card">
          <h3>{"Order & customer"}</h3>
          <dl>
            <div>
              <dt>Order</dt>
              <dd>
                {String(i?.number || getRecordLabel("orders", r.orderId))}
              </dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>{String(a?.name || "—")}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{String(a?.email || "—")}</dd>
            </div>
            <div>
              <dt>Payment status</dt>
              <dd>{String(i?.payment || "—")}</dd>
            </div>
          </dl>
        </section>
        <section className="payment-detail-card">
          <h3>{"Settlement & review"}</h3>
          <dl>
            <div>
              <dt>Settlement</dt>
              <dd>{String(r.settlement || "Pending")}</dd>
            </div>
            <div>
              <dt>Batch</dt>
              <dd>{String(r.settlementRef || "—")}</dd>
            </div>
            <div>
              <dt>Reconciliation</dt>
              <dd>{String(r.reconciliation || "—")}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{String(r.date || "—")}</dd>
            </div>
          </dl>
          {o ? (
            <p className="payment-settlement-note">
              {String(o.status || "")}
              {" · "}
              {formatCurrency(Number(o.net || 0), 2)}
              {" net · expected "}
              {String(o.expected || "TBD")}
            </p>
          ) : null}
        </section>
      </div>
      <p className="payment-demo-note">
        This workspace records demo payment operations locally. Provider
        captures, refunds and payouts still require a verified server
        integration.
      </p>
      <div className="button-row payment-detail-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            navigate(
              `/commerce/orders?q=${encodeURIComponent(getRecordLabel("orders", r.orderId))}`,
            )
          }
        >
          View order
        </button>
        {r.settlementRef ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              navigate(
                `/commerce/settlements?q=${encodeURIComponent(String(r.settlementRef))}`,
              )
            }
          >
            View settlement
          </button>
        ) : null}
        <button
          type="button"
          className="secondary-button"
          onClick={() => void s()}
        >
          Copy reference
        </button>
        {r.reconciliation === "Needs review" ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => onMarkReviewed(r)}
          >
            Mark reconciled
          </button>
        ) : null}
      </div>
    </AppDialog>
  );
}
