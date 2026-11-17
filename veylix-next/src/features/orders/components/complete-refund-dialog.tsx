// @ts-nocheck
import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { getTodayIsoDate } from "@/features/orders/lib/order-operations-dialog";
import { showToast } from "@/lib/events";
import { findRecord } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

export function CompleteRefundDialog({ id, onClose, onChanged }) {
  const r = findRecord("refunds", id);
  const [i, a] = useState("");
  return r ? (
    <AppDialog
      title="Complete refund"
      onClose={onClose}
      wide
      className="ops-detail-dialog"
    >
      <form
        className="c-form"
        onSubmit={(r) => {
          r.preventDefault();
          a("");
          try {
            const i = new FormData(r.currentTarget);
            const a = String(i.get("providerStatus") || "");
            saveRecord(
              "refunds",
              {
                providerStatus: a,
                processedAt: String(i.get("processedAt") || ""),
                status: a === "Succeeded" ? "Completed" : "Processing",
              },
              id,
            );
            onClose();
            onChanged();
            showToast(
              a === "Succeeded"
                ? "Refund completed."
                : "Provider failure recorded; refund remains in processing.",
            );
          } catch (e) {
            a(
              e instanceof Error ? e.message : "Refund could not be completed.",
            );
          }
        }}
      >
        <fieldset>
          <legend>Processing result</legend>
          <div className="c-form-grid">
            <label className="c-field">
              <span>Provider processing *</span>
              <select
                name="providerStatus"
                defaultValue={String(r.providerStatus || "Succeeded")}
                required
              >
                <option>Succeeded</option>
                <option>Failed</option>
              </select>
            </label>
            <label className="c-field">
              <span>Processed date *</span>
              <input
                type="date"
                name="processedAt"
                defaultValue={String(r.processedAt || getTodayIsoDate())}
                required
              />
            </label>
          </div>
        </fieldset>
        <p className="c-form-error" role="alert">
          {i}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            Complete refund
          </button>
        </div>
      </form>
    </AppDialog>
  ) : null;
}
