// @ts-nocheck
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { vendorOrderNumericFields } from "@/features/marketplace/data/vendor-orders";
import { saveVendorOrderSplit } from "@/features/marketplace/lib/vendor-order-splits";
import {
  getVendorOrderField,
  readVendorOrderForm,
} from "@/features/marketplace/lib/vendor-orders";
import { showToast } from "@/lib/events";

export function AddVendorSplitDialog({ onClose, onChanged }) {
  const [n, r] = useState("");
  const i = (e) => (
    <FormField
      key={e}
      field={getVendorOrderField(e)}
      value={
        vendorOrderNumericFields.has(e)
          ? 0
          : e === "payoutStatus"
            ? "Unscheduled"
            : e === "status"
              ? "Pending"
              : ""
      }
      prefix="vendor-split-new"
    />
  );
  return (
    <AppDialog
      title="Add vendor split"
      onClose={onClose}
      wide
      className="vendor-detail-dialog commission-detail-dialog"
    >
      <form
        className="c-form vendor-editor-form vendor-split-editor"
        onSubmit={(n) => {
          n.preventDefault();
          r("");
          try {
            saveVendorOrderSplit(readVendorOrderForm(n.currentTarget));
            showToast(
              "Vendor split created with the current commission rule snapshot.",
            );
            onChanged();
            onClose();
          } catch (e) {
            r(
              e instanceof Error
                ? e.message
                : "Vendor split could not be created.",
            );
          }
        }}
      >
        <fieldset>
          <legend>Ownership</legend>
          <div className="c-form-grid">
            {["orderId", "vendorId", "productId"].map(i)}
          </div>
        </fieldset>
        <fieldset>
          <legend>Order economics</legend>
          <div className="c-form-grid">
            {[
              "itemRevenue",
              "shipping",
              "tax",
              "discount",
              "vendorDiscount",
              "marketplaceDiscount",
              "fees",
              "refunds",
              "chargebacks",
              "adjustments",
            ].map(i)}
          </div>
        </fieldset>
        <fieldset>
          <legend>Settlement and fulfillment</legend>
          <div className="c-form-grid">
            {["payoutStatus", "date", "status"].map(i)}
          </div>
        </fieldset>
        <div className="commission-simulator-note">
          <Icon name="info" />
          <p>
            When you create this split, Veylix resolves the most specific active
            commission rule and stores an immutable snapshot with the order
            line.
          </p>
        </div>
        <p className="c-form-error" role="alert">
          {n}
        </p>
        <div className="c-form-footer">
          <button className="primary-button" type="submit">
            Create split
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
