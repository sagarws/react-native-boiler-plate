// @ts-nocheck
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { showToast } from "@/lib/events";
import { findRecord, listRecords } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

export function VendorCommissionDialog({ id, onClose, onChanged }) {
  const r = findRecord("vendors", id);
  const [i, a] = useState("");
  return r ? (
    <AppDialog
      title={`Commission · ${String(r.name)}`}
      onClose={onClose}
      wide
      className="vendor-detail-dialog"
    >
      <form
        className="c-form vendor-commission-form"
        onSubmit={(t) => {
          t.preventDefault();
          a("");
          try {
            const i = new FormData(t.currentTarget);
            const a = String(i.get("commissionPlan") || "Standard");
            const o = Number(i.get("commission") || 0);
            if (!Number.isFinite(o) || o < 0 || o > 100)
              throw Error("Default vendor rate must be between 0% and 100%.");
            saveRecord(
              "vendors",
              {
                ...r,
                commissionPlan: a,
                commission: o,
              },
              id,
            );
            const s = listRecords("commissions").find(
              (t) => t.scope === "Specific vendor" && t.value === id,
            );
            saveRecord(
              "commissions",
              {
                ...(s || {
                  name: `${String(r.name)} commercial terms`,
                  priority: 40,
                  scope: "Specific vendor",
                  value: id,
                  calculation: "Percentage",
                  fixed: 0,
                  minimumFee: 0,
                  feeCap: 0,
                  commissionBase: "Item revenue after vendor discounts",
                  shippingTreatment: "Exclude shipping",
                  taxTreatment: "Exclude tax",
                  discountFunding: "Vendor funded",
                  refundPolicy: "Reverse commission",
                  effectiveFrom: new Date().toISOString().slice(0, 10),
                  effectiveTo: "",
                  status: "Active",
                  notes:
                    "Vendor-specific terms managed from the vendor workspace.",
                }),
                rate: o,
                status: "Active",
              },
              s?.id,
            );
            showToast(
              "Vendor commercial terms updated. Existing booked order snapshots were preserved.",
            );
            onChanged();
          } catch (e) {
            a(
              e instanceof Error
                ? e.message
                : "Commission terms could not be saved.",
            );
          }
        }}
      >
        <fieldset>
          <legend>Vendor commercial terms</legend>
          <div className="c-form-grid">
            <label className="c-field">
              <span>Commission plan</span>
              <select
                name="commissionPlan"
                defaultValue={String(r.commissionPlan || "Standard")}
              >
                {["Standard", "Growth", "Strategic", "Custom"].map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </select>
            </label>
            <label className="c-field">
              <span>Default vendor rate (%)</span>
              <input
                name="commission"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={Number(r.commission || 0)}
                required
              />
            </label>
          </div>
        </fieldset>
        <div className="vendor-commission-preview">
          <span>
            <Icon name="seal-percent" />
          </span>
          <div>
            <small>New-order override</small>
            <strong>
              Creates or updates a specific-vendor commission rule
            </strong>
            <p>
              Existing vendor order lines keep their immutable booked snapshot,
              so historical payouts do not change.
            </p>
          </div>
        </div>
        <p className="c-form-error" role="alert">
          {i}
        </p>
        <div className="c-form-footer">
          <button className="primary-button" type="submit">
            Save commercial terms
          </button>
        </div>
      </form>
    </AppDialog>
  ) : null;
}
