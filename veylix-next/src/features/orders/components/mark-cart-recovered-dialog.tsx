// @ts-nocheck
import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { getTodayIsoDate } from "@/features/orders/lib/order-operations-dialog";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { findRecord, listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";
import { saveRecord } from "@/lib/store/records";

export function MarkCartRecoveredDialog({ id, onClose, onChanged }) {
  const r = findRecord("abandoned", id);
  const [i, a] = useState("");
  if (!r) return null;
  const o = listRecords("orders").filter(
    (e) => !r.customerId || e.customerId === r.customerId,
  );
  return (
    <AppDialog
      title={`Mark ${String(r.checkoutRef || "checkout")} recovered`}
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
            saveRecord(
              "abandoned",
              {
                recoveredOrderId: String(i.get("recoveredOrderId") || ""),
                lastContact: String(i.get("lastContact") || ""),
                nextAction: "",
                recoveryStage: "Recovered",
                status: "Recovered",
              },
              id,
            );
            onClose();
            onChanged();
            showToast("Checkout marked recovered and linked to the order.");
          } catch (e) {
            a(
              e instanceof Error
                ? e.message
                : "Checkout could not be marked recovered.",
            );
          }
        }}
      >
        <fieldset>
          <legend>Conversion outcome</legend>
          <div className="c-form-grid">
            <label className="c-field">
              <span>Recovered order *</span>
              <select
                name="recoveredOrderId"
                defaultValue={String(r.recoveredOrderId || "")}
                required
              >
                <option value="">Choose order</option>
                {o.map((e) => (
                  <option key={e.id} value={e.id}>
                    {String(e.number || "")}
                    {" · "}
                    {formatCurrency(calculateOrderTotal(e), 2)}
                  </option>
                ))}
              </select>
            </label>
            <label className="c-field">
              <span>Last contact</span>
              <input
                type="date"
                name="lastContact"
                defaultValue={String(r.lastContact || getTodayIsoDate())}
              />
            </label>
          </div>
        </fieldset>
        <p className="c-form-error" role="alert">
          {i}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            Mark recovered
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
