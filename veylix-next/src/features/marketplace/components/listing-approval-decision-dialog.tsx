// @ts-nocheck
import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import {
  rejectListingReview,
  requestListingChanges,
} from "@/features/marketplace/lib/marketplace-review-actions";
import { showToast } from "@/lib/events";
import { findRecord } from "@/lib/store/core";

export function ListingApprovalDecisionDialog({
  id,
  mode,
  onClose,
  onChanged,
}) {
  const [s, c] = useState("");
  const i = findRecord("approvals", id);
  if (!i) return null;
  const a = findRecord("products", String(i.productId || ""));
  const o = mode === "reject";
  return (
    <AppDialog
      title={`${o ? "Reject" : "Request changes"} · ${String(a?.name || i.productId || "Product")}`}
      onClose={onClose}
      wide
      className="vendor-detail-dialog marketplace-review-dialog"
    >
      <form
        className="c-form marketplace-decision-form"
        onSubmit={(t) => {
          t.preventDefault();
          c("");
          try {
            const i = new FormData(t.currentTarget);
            const s = String(i.get("reviewer") || "Alex Chen");
            const c = String(i.get("feedback") || "");
            if (o) {
              rejectListingReview(id, s, c);
            } else {
              requestListingChanges(id, s, c);
            }
            onClose();
            onChanged();
            showToast(
              o
                ? `${String(a?.name || "Product")} rejected from marketplace publishing.`
                : `Changes requested for ${String(a?.name || "Product")}.`,
            );
          } catch (e) {
            c(
              e instanceof Error
                ? e.message
                : "The decision could not be saved.",
            );
          }
        }}
      >
        <fieldset>
          <legend>{o ? "Decision record" : "Vendor feedback"}</legend>
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
              <span>{o ? "Reason for rejection" : "Changes required"}</span>
              <textarea
                name="feedback"
                required
                defaultValue={
                  o
                    ? "This listing cannot be approved in its current form."
                    : "Please update the highlighted listing details and resubmit for review."
                }
              />
            </label>
          </div>
        </fieldset>
        <p className="c-form-error" role="alert">
          {s}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            {o ? "Reject listing" : "Send change request"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
