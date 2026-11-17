// @ts-nocheck
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { PayoutStatusPill } from "@/features/marketplace/components/payout-status-pill";
import {
  formatPayoutDate,
  formatPayoutMoney,
  readPayoutBatchForm,
} from "@/features/marketplace/lib/payout-helpers";
import {
  calculatePayoutStatement,
  computeVendorOrderSettlement,
  readMarketplaceSettlementSettings,
  savePayoutBatch,
} from "@/features/marketplace/lib/settlements";
import { showToast } from "@/lib/events";
import { navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";

export function PayoutBatchDialog({ state, onClose, onChanged, onEdit }) {
  const i = state.id ? findRecord("payouts", state.id) : void 0;
  const a = readMarketplaceSettlementSettings();
  const o = listRecords("vendors").filter((e) => e.status !== "Suspended");
  const s = new Date().toISOString().slice(0, 10);
  const c = i || {
    vendorId: o[0]?.id || "",
    reference: `SET-${String(listRecords("payouts").length + 43).padStart(4, "0")}`,
    periodStart: "2026-05-01",
    periodEnd: s,
    currency: "USD",
    method: "Bank transfer",
    destination: "",
    schedule: a.payout || "Weekly",
    expectedAt: s,
    reserveHeld: 0,
    adjustment: 0,
    status: "Draft",
    holdReason: "",
    notes: "",
  };
  const [u, d] = useState("");
  if (state.kind === "detail" && i) {
    const e = calculatePayoutStatement(i);
    const n = findRecord("vendors", i.vendorId);
    return (
      <AppDialog
        title={`${String(i.reference)} · payout statement`}
        onClose={onClose}
        wide
        className="vendor-detail-dialog commission-detail-dialog"
      >
        <div className="vendor-finance-hero payout-detail-hero">
          <span>
            <Icon name="wallet" />
          </span>
          <div>
            <small>
              {getRecordLabel("vendors", i.vendorId)}
              {" · "}
              {String(i.method || "Settlement")}
            </small>
            <h2>{formatPayoutMoney(e.amount)}</h2>
            <p>
              {String(i.currency || "USD")}
              {" vendor payout · "}
              {String(i.schedule || "Manual")}
            </p>
          </div>
          <PayoutStatusPill value={i.status} />
        </div>
        <div className="vendor-detail-metrics">
          <div>
            <small>Shopper gross</small>
            <strong>{formatPayoutMoney(e.gross)}</strong>
          </div>
          <div>
            <small>Commission + fees</small>
            <strong>{formatPayoutMoney(e.commission)}</strong>
          </div>
          <div>
            <small>Refund exposure</small>
            <strong>{formatPayoutMoney(e.refunds)}</strong>
          </div>
          <div>
            <small>Vendor net</small>
            <strong>{formatPayoutMoney(e.vendorNet)}</strong>
          </div>
        </div>
        <div className="commission-result-flow payout-statement-flow">
          <div>
            <small>Vendor net</small>
            <strong>{formatPayoutMoney(e.vendorNet)}</strong>
          </div>
          <span>
            <Icon name="arrow-right" />
          </span>
          <div>
            <small>Adjustment</small>
            <strong>
              {e.adjustment >= 0 ? "+" : ""}
              {formatPayoutMoney(e.adjustment)}
            </strong>
          </div>
          <span>
            <Icon name="arrow-right" />
          </span>
          <div>
            <small>Reserve held</small>
            <strong>−{formatPayoutMoney(e.reserve)}</strong>
          </div>
          <span>
            <Icon name="arrow-right" />
          </span>
          <div>
            <small>Net payout</small>
            <strong>{formatPayoutMoney(e.amount)}</strong>
          </div>
        </div>
        <div className="vendor-detail-grid">
          <section>
            <h3>Settlement details</h3>
            <dl>
              <div>
                <dt>Period</dt>
                <dd>
                  {formatPayoutDate(i.periodStart)}
                  {" → "}
                  {formatPayoutDate(i.periodEnd)}
                </dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd>{String(i.destination || "—")}</dd>
              </div>
              <div>
                <dt>Expected</dt>
                <dd>{formatPayoutDate(i.expectedAt)}</dd>
              </div>
              <div>
                <dt>Processed</dt>
                <dd>{formatPayoutDate(i.processedAt)}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Vendor readiness</h3>
            <dl>
              <div>
                <dt>Verification</dt>
                <dd>{String(n?.kyc || "—")}</dd>
              </div>
              <div>
                <dt>Vendor payout state</dt>
                <dd>{String(n?.payoutStatus || "—")}</dd>
              </div>
              <div>
                <dt>Included lines</dt>
                <dd>{e.splits.length}</dd>
              </div>
              <div>
                <dt>Hold reason</dt>
                <dd>{String(i.holdReason || "None")}</dd>
              </div>
            </dl>
          </section>
        </div>
        <section className="vendor-detail-section">
          <div>
            <h3>Included vendor orders</h3>
            <span>
              {e.splits.length}
              {" lines"}
            </span>
          </div>
          <div className="vendor-finance-list">
            {e.splits.length ? (
              e.splits.map((e) => {
                const t = computeVendorOrderSettlement(e);
                return (
                  <div key={e.id}>
                    <span>
                      <strong>{getRecordLabel("orders", e.orderId)}</strong>
                      <small>
                        {getRecordLabel("products", e.productId)}
                        {" · "}
                        {formatPayoutDate(e.date)}
                      </small>
                    </span>
                    <span>
                      <strong>{formatPayoutMoney(t.vendorNet)}</strong>
                      <small>{String(e.payoutStatus || "Scheduled")}</small>
                    </span>
                  </div>
                );
              })
            ) : (
              <p>No linked vendor order lines.</p>
            )}
          </div>
        </section>
        <div className="button-row vendor-detail-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              navigate(
                `/commerce/vendors?q=${encodeURIComponent(getRecordLabel("vendors", i.vendorId))}`,
              )
            }
          >
            Vendor profile
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              navigate(
                `/commerce/vendor-orders?q=${encodeURIComponent(getRecordLabel("vendors", i.vendorId))}`,
              )
            }
          >
            Vendor orders
          </button>
          {["Paid", "Cancelled"].includes(String(i.status)) ? null : (
            <button
              type="button"
              className="primary-button"
              onClick={() => onEdit(i.id)}
            >
              Edit batch
            </button>
          )}
        </div>
      </AppDialog>
    );
  }
  return (
    <AppDialog
      title={i ? "Edit payout batch" : "Create payout batch"}
      onClose={onClose}
      wide
      className="vendor-detail-dialog commission-detail-dialog"
    >
      <form
        className="c-form vendor-split-editor"
        onSubmit={(e) => {
          e.preventDefault();
          d("");
          try {
            savePayoutBatch(readPayoutBatchForm(e.currentTarget), i?.id || "");
            showToast(
              i
                ? "Payout batch updated."
                : "Payout batch created and eligible vendor lines reserved.",
            );
            onChanged();
            onClose();
          } catch (e) {
            d(
              e instanceof Error
                ? e.message
                : "Payout batch could not be saved.",
            );
          }
        }}
      >
        <fieldset>
          <legend>Settlement scope</legend>
          <div className="c-form-grid">
            <FormField
              field={{
                key: "vendorId",
                label: "Vendor",
                type: "text",
                relation: "vendors",
                required: true,
              }}
              value={c.vendorId}
              prefix="payout"
            />
            <FormField
              field={{
                key: "reference",
                label: "Settlement reference",
                type: "text",
                required: true,
              }}
              value={c.reference}
              prefix="payout"
            />
            <FormField
              field={{
                key: "periodStart",
                label: "Period start",
                type: "date",
                required: true,
              }}
              value={c.periodStart}
              prefix="payout"
            />
            <FormField
              field={{
                key: "periodEnd",
                label: "Period end",
                type: "date",
                required: true,
              }}
              value={c.periodEnd}
              prefix="payout"
            />
          </div>
        </fieldset>
        <fieldset>
          <legend>Payout controls</legend>
          <div className="c-form-grid">
            <FormField
              field={{
                key: "currency",
                label: "Currency",
                type: "select",
                options: ["USD", "EUR", "GBP", "CAD"],
              }}
              value={c.currency}
              prefix="payout"
            />
            <FormField
              field={{
                key: "method",
                label: "Payout method",
                type: "select",
                options: [
                  "Bank transfer",
                  "PayPal",
                  "Stripe Connect",
                  "Manual",
                ],
              }}
              value={c.method}
              prefix="payout"
            />
            <FormField
              field={{
                key: "destination",
                label: "Destination account",
                type: "text",
              }}
              value={c.destination}
              prefix="payout"
            />
            <FormField
              field={{
                key: "schedule",
                label: "Settlement schedule",
                type: "select",
                options: ["Weekly", "Biweekly", "Monthly", "Manual"],
              }}
              value={c.schedule}
              prefix="payout"
            />
            <FormField
              field={{
                key: "expectedAt",
                label: "Expected payout",
                type: "date",
              }}
              value={c.expectedAt}
              prefix="payout"
            />
            <FormField
              field={{
                key: "reserveHeld",
                label: "Reserve held",
                type: "money",
                min: 0,
              }}
              value={c.reserveHeld}
              prefix="payout"
            />
            <FormField
              field={{
                key: "adjustment",
                label: "Manual adjustment",
                type: "number",
                min: -1e5,
              }}
              value={c.adjustment}
              prefix="payout"
            />
            <FormField
              field={{
                key: "status",
                label: "Status",
                type: "select",
                options: [
                  "Draft",
                  "Ready for processing",
                  "Processing",
                  "On hold",
                ],
              }}
              value={
                ["Paid", "Cancelled"].includes(String(c.status))
                  ? "Draft"
                  : c.status
              }
              prefix="payout"
            />
          </div>
        </fieldset>
        <fieldset>
          <legend>Review notes</legend>
          <div className="c-form-grid">
            <FormField
              field={{
                key: "holdReason",
                label: "Hold / failure reason",
                type: "text",
              }}
              value={c.holdReason}
              prefix="payout"
            />
            <FormField
              field={{
                key: "notes",
                label: "Internal notes",
                type: "textarea",
              }}
              value={c.notes}
              prefix="payout"
            />
          </div>
        </fieldset>
        <div className="commission-simulator-note">
          <Icon name="info" />
          <p>
            The net payout is calculated from eligible vendor order lines in the
            selected period, plus the adjustment, minus the reserve held.
            Creating a batch reserves those lines so they cannot be included in
            another open settlement.
          </p>
        </div>
        <p className="c-form-error" role="alert">
          {u}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            {i ? "Save payout batch" : "Create payout batch"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
