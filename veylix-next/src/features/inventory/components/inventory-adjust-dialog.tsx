// @ts-nocheck
import { useMemo, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { getActiveWarehouses } from "@/features/inventory/lib/stock-levels";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { showToast } from "@/lib/events";
import {
  adjustProductStock,
  getProductLocationStock,
} from "@/lib/store/inventory";

const inventoryAdjustIconMap = {
  tee: "t-shirt",
  mug: "coffee",
  bottle: "thermometer",
};

export function InventoryAdjustDialog({ row, onClose, onChanged }) {
  const [r, i] = useState("");
  const a = useMemo(() => getActiveWarehouses(), []);
  const o = getProductLocationStock(row);
  const s =
    [...a].sort((e, t) => Number(o?.[t.id] || 0) - Number(o?.[e.id] || 0))[0]
      ?.id ||
    a[0]?.id ||
    "";
  const c = Array.isArray(row.mediaIds) ? row.mediaIds : [];
  return (
    <AppDialog
      title={`Adjust ${String(row.name || "")}`}
      onClose={onClose}
      wide
    >
      <div className="inventory-adjust-summary">
        <OverviewProductThumb
          product={{
            mediaId: c.length ? String(c[0] || "") : void 0,
            icon:
              inventoryAdjustIconMap[String(row.image || "")] ||
              String(row.image || ""),
          }}
        />
        <div>
          <strong>{String(row.name || "")}</strong>
          <small>
            {String(row.stock ?? 0)}
            {" units on hand across "}
            {a.length}
            {" active locations"}
          </small>
        </div>
      </div>
      <form
        className="c-form"
        data-c-form="stock"
        data-id={row.id}
        onSubmit={(r) => {
          r.preventDefault();
          i("");
          try {
            const i = Object.fromEntries(new FormData(r.currentTarget));
            adjustProductStock(
              row.id,
              Number(i.delta),
              String(i.reason || ""),
              String(i.warehouseId || ""),
            );
            onClose();
            onChanged();
            showToast("Inventory adjustment saved.");
          } catch (e) {
            i(
              e instanceof Error
                ? e.message
                : "This stock adjustment could not be saved.",
            );
          }
        }}
      >
        <FormField
          field={{
            key: "warehouseId",
            label: "Inventory location",
            type: "text",
            relation: "warehouses",
            required: true,
          }}
          value={s}
        />
        <FormField
          field={{
            key: "delta",
            label: "Quantity change (+ or −)",
            type: "number",
            integer: true,
            required: true,
          }}
        />
        <FormField
          field={{
            key: "reason",
            label: "Reason",
            type: "textarea",
            required: true,
          }}
        />
        <p className="c-form-error" role="alert">
          {r}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            Save adjustment
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
