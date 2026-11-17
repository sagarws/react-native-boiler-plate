// @ts-nocheck
import { Fragment, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import {
  approveVendorApplication,
  rejectVendorApplication,
  requestApplicationChanges,
} from "@/features/marketplace/lib/marketplace-review-actions";
import { showToast } from "@/lib/events";
import { findRecord, listRecords } from "@/lib/store/core";

export function VendorApplicationDecisionDialog({
  mode,
  id,
  onClose,
  onChanged,
}) {
  const [o, s] = useState("");
  const i = findRecord("applications", id);
  if (!i) return null;
  const a = listRecords("vendors").find(
    (e) =>
      String(e.email || "").toLowerCase() ===
        String(i.email || "").toLowerCase() ||
      String(e.name || "").toLowerCase() === String(i.name || "").toLowerCase(),
  );
  const c =
    mode === "approve"
      ? `Approve ${String(i.name)}`
      : mode === "request"
        ? `Request documents · ${String(i.name)}`
        : `Reject ${String(i.name)}`;
  return (
    <AppDialog
      title={c}
      onClose={onClose}
      wide
      className="vendor-detail-dialog marketplace-review-dialog"
    >
      <form
        className="c-form marketplace-decision-form"
        onSubmit={(a) => {
          a.preventDefault();
          s("");
          try {
            const o = new FormData(a.currentTarget);
            if (mode === "approve") {
              approveVendorApplication(id, {
                commissionPlan: String(o.get("commissionPlan") || "Standard"),
                commission: Number(o.get("commission") || 0),
                brand: String(o.get("brand") || "Veylix Studio"),
                payoutStatus: String(o.get("payoutStatus") || "Setup required"),
                reviewer: String(o.get("reviewer") || "Alex Chen"),
              });
            } else if (mode === "request") {
              requestApplicationChanges(
                id,
                String(o.get("reviewer") || "Alex Chen"),
                String(o.get("request") || ""),
              );
            } else {
              rejectVendorApplication(
                id,
                String(o.get("reviewer") || "Alex Chen"),
                String(o.get("reason") || ""),
              );
            }
            onClose();
            onChanged();
            showToast(
              mode === "approve"
                ? `${String(i.name)} approved with a specific-vendor commission rule for new marketplace orders.`
                : mode === "request"
                  ? `Document request recorded for ${String(i.name)}.`
                  : `${String(i.name)} application rejected.`,
            );
          } catch (e) {
            s(
              e instanceof Error
                ? e.message
                : "The decision could not be saved.",
            );
          }
        }}
      >
        {mode === "approve" ? (
          <Fragment>
            <fieldset>
              <legend>Partner commercial terms</legend>
              <div className="c-form-grid">
                <label className="c-field">
                  <span>Commission plan</span>
                  <select
                    name="commissionPlan"
                    defaultValue={String(a?.commissionPlan || "Standard")}
                  >
                    {["Standard", "Growth", "Strategic", "Custom"].map((e) => (
                      <option key={e}>{e}</option>
                    ))}
                  </select>
                </label>
                <label className="c-field">
                  <span>Commission rate (%)</span>
                  <input
                    name="commission"
                    type="number"
                    min="0"
                    max="100"
                    required
                    defaultValue={Number(a?.commission ?? 12)}
                  />
                </label>
                <label className="c-field">
                  <span>Catalog brand</span>
                  <select
                    name="brand"
                    defaultValue={String(a?.brand || "Veylix Studio")}
                  >
                    {["Veylix Studio", "Northline", "Forma"].map((e) => (
                      <option key={e}>{e}</option>
                    ))}
                  </select>
                </label>
                <label className="c-field">
                  <span>Payout setup</span>
                  <select
                    name="payoutStatus"
                    defaultValue={String(a?.payoutStatus || "Setup required")}
                  >
                    {["Ready", "On hold", "Setup required"].map((e) => (
                      <option key={e}>{e}</option>
                    ))}
                  </select>
                </label>
                <label className="c-field">
                  <span>Reviewer</span>
                  <input
                    name="reviewer"
                    required
                    defaultValue={String(i.reviewer || "Alex Chen")}
                  />
                </label>
              </div>
            </fieldset>
            <div className="marketplace-decision-preview">
              <span>
                <Icon name="seal-percent" />
              </span>
              <div>
                <strong>
                  Approval creates or activates the vendor profile
                </strong>
                <p>
                  The application is marked approved, verification becomes
                  complete, and future marketplace order economics use the
                  assigned commission terms. Historical vendor-order rates stay
                  unchanged.
                </p>
              </div>
            </div>
          </Fragment>
        ) : (
          <fieldset>
            <legend>
              {mode === "request" ? "Applicant follow-up" : "Decision record"}
            </legend>
            <div className="c-form-grid">
              <label className="c-field">
                <span>Reviewer</span>
                <input
                  name="reviewer"
                  required
                  defaultValue={String(i.reviewer || "Alex Chen")}
                />
              </label>
              <label className="c-field">
                <span>{mode === "request" ? "What is needed?" : "Reason"}</span>
                <textarea
                  name={mode === "request" ? "request" : "reason"}
                  required
                  defaultValue={
                    mode === "request"
                      ? "Please provide the missing verification and payout ownership documents."
                      : "Marketplace requirements are not met at this time."
                  }
                />
              </label>
            </div>
          </fieldset>
        )}
        <p className="c-form-error" role="alert">
          {o}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            {mode === "approve"
              ? "Approve & activate vendor"
              : mode === "request"
                ? "Send request"
                : "Reject application"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
