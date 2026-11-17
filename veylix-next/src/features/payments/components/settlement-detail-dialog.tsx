// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { SettlementStatusPill } from "@/features/payments/components/settlement-status-pill";
import { getSignedTransactionAmount } from "@/features/payments/lib/payment-metrics";
import { showToast } from "@/lib/events";
import { formatCurrency, formatNumber } from "@/lib/format";
import { navigate } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";

export function SettlementDetailDialog({ id, onClose, onOpenTransaction }) {
  const r = findRecord("settlements", id);
  if (!r) return null;
  const i = listRecords("transactions").filter(
    (e) => e.settlementRef === r.reference,
  );
  const a = async () => {
    try {
      await navigator.clipboard.writeText(String(r.reference || ""));
      showToast("Settlement reference copied.");
    } catch {
      showToast("Copy is unavailable in this browser.");
    }
  };
  return (
    <AppDialog
      title={String(r.reference || "Settlement")}
      onClose={onClose}
      wide
      className="payment-detail-dialog"
    >
      <div className="payment-detail-hero">
        <span>
          <Icon name="wallet" />
        </span>
        <div>
          <small>
            {String(r.provider || "")}
            {" · "}
            {String(r.period || "Settlement period")}
          </small>
          <h2>{formatCurrency(Number(r.net || 0), 2)}</h2>
          <p>
            {"Net settlement · "}
            {String(r.currency || "USD")}
          </p>
        </div>
        <SettlementStatusPill value={String(r.status || "Pending")} />
      </div>
      <div className="payment-detail-metrics">
        <div>
          <small>Gross volume</small>
          <strong>{formatCurrency(Number(r.gross || 0), 2)}</strong>
        </div>
        <div>
          <small>Fees</small>
          <strong>{formatCurrency(Number(r.fees || 0), 2)}</strong>
        </div>
        <div>
          <small>Refunds</small>
          <strong>{formatCurrency(Number(r.refunds || 0), 2)}</strong>
        </div>
        <div>
          <small>Transactions</small>
          <strong>{formatNumber(Number(r.transactions || 0))}</strong>
        </div>
      </div>
      <div className="payment-detail-grid">
        <section className="payment-detail-card">
          <h3>Destination</h3>
          <dl>
            <div>
              <dt>Account</dt>
              <dd>{String(r.bankAccount || "—")}</dd>
            </div>
            <div>
              <dt>Expected</dt>
              <dd>{String(r.expected || "—")}</dd>
            </div>
            <div>
              <dt>Paid date</dt>
              <dd>{String(r.paidAt || "—")}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{String(r.status || "—")}</dd>
            </div>
          </dl>
        </section>
        <section className="payment-detail-card">
          <h3>Included ledger records</h3>
          {i.length ? (
            <div className="settlement-transaction-list">
              {i.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onOpenTransaction(e.id)}
                >
                  <span>
                    <strong>{String(e.reference || "")}</strong>
                    <small>
                      {String(e.type || "")}
                      {" · "}
                      {String(e.status || "")}
                    </small>
                  </span>
                  <b>{formatCurrency(getSignedTransactionAmount(e), 2)}</b>
                </button>
              ))}
            </div>
          ) : (
            <p className="payment-panel-empty">
              No demo transactions are linked to this batch.
            </p>
          )}
        </section>
      </div>
      <p className="payment-demo-note">
        Settlement values in this theme demo are local sample data. Verify
        actual payout amounts and bank arrival with signed provider events on
        your backend.
      </p>
      <div className="button-row payment-detail-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            navigate(
              `/commerce/transactions?q=${encodeURIComponent(String(r.reference || ""))}`,
            )
          }
        >
          View transactions
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void a()}
        >
          Copy reference
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => navigate("/commerce/providers")}
        >
          Provider settings
        </button>
      </div>
    </AppDialog>
  );
}
