// @ts-nocheck
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import {
  getCommissionField,
  readCommissionFormValues,
  readCommissionValue,
  vendorTierOptions,
} from "@/features/marketplace/lib/commission-display";
import { saveCommissionRule } from "@/features/marketplace/lib/commission-rules";
import { showToast } from "@/lib/events";
import { findRecord, listRecords } from "@/lib/store/core";

export function CommissionRuleEditorDialog({ id, onClose, onChanged }) {
  const r = id ? findRecord("commissions", id) : void 0;
  const [i, a] = useState("");
  const o = [
    ...new Set(
      listRecords("vendors")
        .map((e) => String(e.category || ""))
        .filter(Boolean),
    ),
  ].sort();
  const s = String(r?.value || "");
  const c = {
    priority: 0,
    scope: "Marketplace default",
    calculation: "Percentage",
    rate: 0,
    fixed: 0,
    minimumFee: 0,
    feeCap: 0,
    commissionBase: "Item revenue after vendor discounts",
    shippingTreatment: "Exclude shipping",
    taxTreatment: "Exclude tax",
    discountFunding: "Vendor funded",
    refundPolicy: "Reverse commission",
    status: "Active",
  };
  const u = (t) => (
    <FormField
      key={t}
      field={getCommissionField(t)}
      value={readCommissionValue(r, t, c[t])}
      prefix={`commission-${id || "new"}`}
    />
  );
  return (
    <AppDialog
      title={
        id ? `Edit ${String(r?.name || "rule")}` : "Create commission rule"
      }
      onClose={onClose}
      wide
      className="vendor-detail-dialog commission-detail-dialog"
    >
      <form
        className="c-form vendor-editor-form commission-rule-editor"
        onSubmit={(r) => {
          r.preventDefault();
          a("");
          try {
            saveCommissionRule(
              readCommissionFormValues(r.currentTarget),
              id || "",
            );
            showToast(
              id ? "Commission rule updated." : "Commission rule created.",
            );
            onChanged();
            onClose();
          } catch (e) {
            a(
              e instanceof Error
                ? e.message
                : "Commission rule could not be saved.",
            );
          }
        }}
      >
        <fieldset>
          <legend>Rule matching</legend>
          <div className="c-form-grid">
            {["name", "priority", "scope"].map(u)}
            <label className="c-field" htmlFor="commission-scope-value">
              <span>Scope target</span>
              <select id="commission-scope-value" name="value" defaultValue={s}>
                <option value="">Marketplace default / no target</option>
                <optgroup label="Vendor tiers">
                  {vendorTierOptions.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Vendor categories">
                  {o.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Vendors">
                  {listRecords("vendors").map((e) => (
                    <option key={e.id} value={e.id}>
                      {String(e.name || e.id)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Products">
                  {listRecords("products").map((e) => (
                    <option key={e.id} value={e.id}>
                      {String(e.name || e.id)}
                      {" · "}
                      {String(e.sku || "")}
                    </option>
                  ))}
                </optgroup>
              </select>
              <small>
                Choose the target that matches the selected rule scope.
              </small>
            </label>
            {["effectiveFrom", "effectiveTo", "status"].map(u)}
          </div>
        </fieldset>
        <fieldset>
          <legend>Fee calculation</legend>
          <div className="c-form-grid">
            {[
              "calculation",
              "rate",
              "fixed",
              "minimumFee",
              "feeCap",
              "commissionBase",
              "shippingTreatment",
              "taxTreatment",
            ].map(u)}
          </div>
        </fieldset>
        <fieldset>
          <legend>Funding and refunds</legend>
          <div className="c-form-grid">
            {["discountFunding", "refundPolicy", "notes"].map(u)}
          </div>
        </fieldset>
        <div className="commission-simulator-note">
          <Icon name="info" />
          <p>
            Rule precedence is product → vendor → category → tier → marketplace
            default; priority only breaks ties inside the same scope. Historical
            vendor-order snapshots never recalculate when a rule changes.
          </p>
        </div>
        <p className="c-form-error" role="alert">
          {i}
        </p>
        <div className="c-form-footer">
          <button className="primary-button" type="submit">
            {id ? "Save rule" : "Create rule"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
