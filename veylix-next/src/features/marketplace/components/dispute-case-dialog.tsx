// @ts-nocheck
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { MarketplaceReviewPill } from "@/features/marketplace/components/marketplace-review-ui";
import {
  formatDisputeDate,
  formatDisputeMoney,
  readDisputeForm,
} from "@/features/marketplace/lib/dispute-helpers";
import {
  getDisputeCustomerName,
  getDisputeOrderTotal,
  getDisputeVendorId,
  readMarketplaceSettlementSettings,
  resolveDispute,
  saveDispute,
} from "@/features/marketplace/lib/settlements";
import { showToast } from "@/lib/events";
import { navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";

export function DisputeCaseDialog({ state, onClose, onChanged, onResolve }) {
  const i = state.id ? findRecord("disputes", state.id) : void 0;
  const a = readMarketplaceSettlementSettings();
  const o = listRecords("orders").filter((e) => e.status !== "Cancelled");
  const s = listRecords("vendors");
  const c = new Date().toISOString().slice(0, 10);
  const u = new Date(Date.now() + Number(a.disputeSla || 7) * 864e5)
    .toISOString()
    .slice(0, 10);
  const d = i || {
    orderId: o[0]?.id || "",
    vendorId: s[0]?.id || "",
    type: "Buyer vs vendor",
    reason: "",
    amount: 0,
    currency: "USD",
    priority: "Normal",
    evidence: "Missing",
    liability: "Undecided",
    payoutImpact: "No hold",
    owner: "Alex Chen",
    openedAt: c,
    deadline: u,
    status: "Open",
    notes: "",
  };
  const [f, p] = useState("");
  if (state.kind === "detail" && i) {
    const e = getDisputeVendorId(i);
    return (
      <AppDialog
        title={`${getRecordLabel("orders", i.orderId)} · dispute`}
        onClose={onClose}
        wide
        className="vendor-detail-dialog marketplace-review-dialog"
      >
        <div className="marketplace-review-hero dispute-detail-hero">
          <span className="vendor-detail-avatar">
            <Icon name="info" />
          </span>
          <div>
            <small>
              {String(i.type || "Marketplace case")}
              {" · "}
              {String(i.priority || "Normal")}
              {" priority"}
            </small>
            <h2>{String(i.reason || "Dispute")}</h2>
            <p>
              {getRecordLabel("vendors", e)}
              {" · "}
              {getDisputeCustomerName(i)}
            </p>
            <div>
              <MarketplaceReviewPill value={i.status} />
              <MarketplaceReviewPill value={i.evidence} />
              <MarketplaceReviewPill value={i.payoutImpact} />
            </div>
          </div>
          <div className="marketplace-review-hero-score">
            <strong>{formatDisputeMoney(Number(i.amount || 0))}</strong>
            <small>amount at risk</small>
          </div>
        </div>
        <div className="vendor-detail-metrics">
          <div>
            <small>Opened</small>
            <strong>{formatDisputeDate(i.openedAt)}</strong>
          </div>
          <div>
            <small>Response deadline</small>
            <strong>{formatDisputeDate(i.deadline)}</strong>
          </div>
          <div>
            <small>Owner</small>
            <strong>{String(i.owner || "Unassigned")}</strong>
          </div>
          <div>
            <small>Liability</small>
            <strong>{String(i.liability || "Undecided")}</strong>
          </div>
        </div>
        <div className="marketplace-review-detail-grid">
          <section>
            <div className="marketplace-review-section-head">
              <h3>Case context</h3>
              <span>
                <Icon name="clipboard-text" />
              </span>
            </div>
            <dl>
              <div>
                <dt>Order</dt>
                <dd>{getRecordLabel("orders", i.orderId)}</dd>
              </div>
              <div>
                <dt>Vendor</dt>
                <dd>{getRecordLabel("vendors", e)}</dd>
              </div>
              <div>
                <dt>Customer</dt>
                <dd>{getDisputeCustomerName(i)}</dd>
              </div>
              <div>
                <dt>Order total</dt>
                <dd>{formatDisputeMoney(getDisputeOrderTotal(i))}</dd>
              </div>
              <div>
                <dt>Resolution</dt>
                <dd>{String(i.resolution || "Pending")}</dd>
              </div>
            </dl>
          </section>
          <section>
            <div className="marketplace-review-section-head">
              <h3>Financial protection</h3>
              <span>
                <Icon name="wallet" />
              </span>
            </div>
            <dl>
              <div>
                <dt>Amount at risk</dt>
                <dd>{formatDisputeMoney(Number(i.amount || 0))}</dd>
              </div>
              <div>
                <dt>Payout impact</dt>
                <dd>{String(i.payoutImpact || "No hold")}</dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>{String(i.evidence || "Missing")}</dd>
              </div>
              <div>
                <dt>Resolved</dt>
                <dd>{formatDisputeDate(i.resolvedAt)}</dd>
              </div>
            </dl>
          </section>
        </div>
        <section className="vendor-detail-section marketplace-notes">
          <div>
            <h3>Case notes</h3>
            <span>{String(i.owner || "Unassigned")}</span>
          </div>
          <p>{String(i.notes || "No internal notes recorded.")}</p>
        </section>
        <div className="button-row vendor-detail-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              navigate(
                `/commerce/orders?q=${encodeURIComponent(getRecordLabel("orders", i.orderId))}`,
              )
            }
          >
            View order
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              navigate(
                `/commerce/vendors?q=${encodeURIComponent(getRecordLabel("vendors", e))}`,
              )
            }
          >
            Vendor profile
          </button>
          {["Resolved", "Closed"].includes(String(i.status)) ? null : (
            <button
              type="button"
              className="primary-button"
              onClick={() => onResolve(i.id)}
            >
              Resolve case
            </button>
          )}
        </div>
      </AppDialog>
    );
  }
  return state.kind === "resolve" && i ? (
    <AppDialog
      title="Resolve marketplace case"
      onClose={onClose}
      wide
      className="vendor-detail-dialog marketplace-review-dialog"
    >
      <form
        className="c-form marketplace-decision-form"
        onSubmit={(e) => {
          e.preventDefault();
          p("");
          try {
            const r = new FormData(e.currentTarget);
            resolveDispute(i.id, {
              liability: String(r.get("liability") || "Vendor"),
              resolution: String(r.get("resolution") || "Release vendor"),
              payoutImpact: String(r.get("payoutImpact") || "No hold"),
              notes: String(r.get("notes") || ""),
            });
            showToast(
              "Marketplace dispute resolved and settlement impact updated.",
            );
            onChanged();
            onClose();
          } catch (e) {
            p(
              e instanceof Error ? e.message : "Dispute could not be resolved.",
            );
          }
        }}
      >
        <fieldset>
          <legend>Resolution</legend>
          <div className="c-form-grid">
            <FormField
              field={{
                key: "liability",
                label: "Liability",
                type: "select",
                options: ["Vendor", "Marketplace", "Carrier", "Customer"],
              }}
              value={i.liability === "Undecided" ? "Vendor" : i.liability}
              prefix="dispute-resolve"
            />
            <FormField
              field={{
                key: "resolution",
                label: "Resolution",
                type: "select",
                options: [
                  "Refund customer",
                  "Release vendor",
                  "Split adjustment",
                  "Reject claim",
                ],
              }}
              value={
                i.resolution === "Pending" ? "Release vendor" : i.resolution
              }
              prefix="dispute-resolve"
            />
            <FormField
              field={{
                key: "payoutImpact",
                label: "Payout after resolution",
                type: "select",
                options: [
                  "No hold",
                  "Hold related payout",
                  "Hold vendor payouts",
                ],
              }}
              value={i.payoutImpact}
              prefix="dispute-resolve"
            />
            <FormField
              field={{
                key: "notes",
                label: "Resolution notes",
                type: "textarea",
                required: true,
              }}
              value="Reviewed evidence and recorded the marketplace decision."
              prefix="dispute-resolve"
            />
          </div>
        </fieldset>
        <p className="c-form-error" role="alert">
          {f}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            Resolve case
          </button>
        </div>
      </form>
    </AppDialog>
  ) : (
    <AppDialog
      title={i ? "Edit dispute case" : "Open dispute case"}
      onClose={onClose}
      wide
      className="vendor-detail-dialog marketplace-review-dialog"
    >
      <form
        className="c-form marketplace-review-editor"
        onSubmit={(e) => {
          e.preventDefault();
          p("");
          try {
            saveDispute(readDisputeForm(e.currentTarget), i?.id || "");
            showToast(
              i ? "Dispute case updated." : "Marketplace dispute opened.",
            );
            onChanged();
            onClose();
          } catch (e) {
            p(e instanceof Error ? e.message : "Dispute could not be saved.");
          }
        }}
      >
        <fieldset>
          <legend>{"Case & parties"}</legend>
          <div className="c-form-grid">
            <FormField
              field={{
                key: "orderId",
                label: "Order",
                type: "text",
                relation: "orders",
                required: true,
              }}
              value={d.orderId}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "vendorId",
                label: "Vendor",
                type: "text",
                relation: "vendors",
                required: true,
              }}
              value={d.vendorId}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "type",
                label: "Case type",
                type: "select",
                options: [
                  "Buyer vs vendor",
                  "Vendor vs marketplace",
                  "Payment dispute",
                  "Delivery claim",
                ],
              }}
              value={d.type}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "reason",
                label: "Reason",
                type: "text",
                required: true,
              }}
              value={d.reason}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "amount",
                label: "Amount at risk",
                type: "money",
                min: 0,
              }}
              value={d.amount}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "currency",
                label: "Currency",
                type: "select",
                options: ["USD", "EUR", "GBP", "CAD"],
              }}
              value={d.currency}
              prefix="dispute"
            />
          </div>
        </fieldset>
        <fieldset>
          <legend>Review controls</legend>
          <div className="c-form-grid">
            <FormField
              field={{
                key: "priority",
                label: "Priority",
                type: "select",
                options: ["Normal", "High", "Urgent"],
              }}
              value={d.priority}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "evidence",
                label: "Evidence",
                type: "select",
                options: ["Missing", "Requested", "Ready"],
              }}
              value={d.evidence}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "liability",
                label: "Liability",
                type: "select",
                options: [
                  "Undecided",
                  "Vendor",
                  "Marketplace",
                  "Carrier",
                  "Customer",
                ],
              }}
              value={d.liability}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "payoutImpact",
                label: "Payout impact",
                type: "select",
                options: [
                  "No hold",
                  "Hold related payout",
                  "Hold vendor payouts",
                ],
              }}
              value={d.payoutImpact}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "owner",
                label: "Case owner",
                type: "text",
              }}
              value={d.owner}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "openedAt",
                label: "Opened",
                type: "date",
              }}
              value={d.openedAt}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "deadline",
                label: "Respond by",
                type: "date",
              }}
              value={d.deadline}
              prefix="dispute"
            />
            <FormField
              field={{
                key: "status",
                label: "Status",
                type: "select",
                options: ["Open", "Evidence required", "Under review"],
              }}
              value={
                ["Resolved", "Closed"].includes(String(d.status))
                  ? "Under review"
                  : d.status
              }
              prefix="dispute"
            />
          </div>
        </fieldset>
        <fieldset>
          <legend>Internal record</legend>
          <div className="c-form-grid">
            <FormField
              field={{
                key: "notes",
                label: "Notes",
                type: "textarea",
              }}
              value={d.notes}
              prefix="dispute"
            />
          </div>
        </fieldset>
        <p className="c-form-error" role="alert">
          {f}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            {i ? "Save case" : "Open dispute case"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
