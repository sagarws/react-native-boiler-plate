// @ts-nocheck
import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { getTodayIsoDate } from "@/features/orders/lib/order-operations-dialog";
import { showToast } from "@/lib/events";
import { findRecord, getRecordLabel } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

export function ApproveCancellationDialog({ id, onClose, onChanged }) {
  const r = findRecord("cancellations", id);
  const i = r ? findRecord("orders", r.orderId) : void 0;
  const [a, o] = useState("");
  return r ? (
    <AppDialog
      title="Approve cancellation"
      onClose={onClose}
      wide
      className="ops-detail-dialog"
    >
      <form
        className="c-form"
        onSubmit={(r) => {
          r.preventDefault();
          o("");
          try {
            const i = new FormData(r.currentTarget);
            saveRecord(
              "cancellations",
              {
                inventoryAction: String(i.get("inventoryAction") || ""),
                refundAction: String(i.get("refundAction") || ""),
                liability: String(i.get("liability") || ""),
                decidedAt: String(i.get("decidedAt") || ""),
                status: "Approved",
              },
              id,
            );
            onClose();
            onChanged();
            showToast("Cancellation approved and order status updated.");
          } catch (e) {
            o(
              e instanceof Error
                ? e.message
                : "Cancellation could not be approved.",
            );
          }
        }}
      >
        <p className="ops-form-context">
          {String(i?.number || getRecordLabel("orders", r.orderId))}
          {" · "}
          {String(i?.status || "Unknown")}
          {" · "}
          {String(i?.payment || "Unknown")}
        </p>
        <fieldset>
          <legend>Approval outcome</legend>
          <div className="c-form-grid">
            {[
              [
                "inventoryAction",
                "Inventory action *",
                [
                  "No change",
                  "Release committed stock",
                  "Restock packed items",
                  "Manual review",
                ],
              ],
              [
                "refundAction",
                "Payment action *",
                [
                  "No payment captured",
                  "Refund required",
                  "Refund completed",
                  "Manual review",
                ],
              ],
              [
                "liability",
                "Liability *",
                [
                  "Customer",
                  "Store",
                  "Vendor",
                  "Carrier",
                  "Shared",
                  "Under review",
                ],
              ],
            ].map(([e, t, n]) => (
              <label key={e} className="c-field">
                <span>{t}</span>
                <select name={e} defaultValue={String(r[e] || n[0])} required>
                  {n.map((e) => (
                    <option key={e}>{e}</option>
                  ))}
                </select>
              </label>
            ))}
            <label className="c-field">
              <span>Decision date *</span>
              <input
                type="date"
                name="decidedAt"
                defaultValue={String(r.decidedAt || getTodayIsoDate())}
                required
              />
            </label>
          </div>
        </fieldset>
        <p className="c-form-error" role="alert">
          {a}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            Approve cancellation
          </button>
        </div>
      </form>
    </AppDialog>
  ) : null;
}
