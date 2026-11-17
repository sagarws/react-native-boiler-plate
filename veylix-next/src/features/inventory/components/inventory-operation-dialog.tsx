// @ts-nocheck
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { modulesById } from "@/config/modules/registry";
import {
  getActiveWarehouses,
  getProductStockLevels,
} from "@/features/inventory/lib/stock-levels";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { showToast } from "@/lib/events";
import { findRecord, listRecords } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

const inventoryOperationIconMap = {
  tee: "t-shirt",
  mug: "coffee",
  bottle: "thermometer",
};

export function renderInventoryOperationThumb(e) {
  const t = Array.isArray(e.mediaIds) ? e.mediaIds : [];
  return (
    <OverviewProductThumb
      product={{
        mediaId: t.length ? String(t[0] || "") : void 0,
        icon:
          inventoryOperationIconMap[String(e.image || "")] ||
          String(e.image || ""),
      }}
    />
  );
}

function getDateInDays(e) {
  const t = new Date();
  t.setDate(t.getDate() + e);
  return t.toISOString().slice(0, 10);
}

function getInventoryFieldValue(e, t) {
  const n = t[e.key];
  return typeof n == "number" ? n : String(n ?? "");
}

export function InventoryOperationDialog({
  kind,
  productId = "",
  onClose,
  onChanged,
}) {
  const i = kind === "transfer" ? "transfers" : "replenishment";
  const a = modulesById[i];
  const o = productId ? findRecord("products", productId) : void 0;
  const [s, c] = useState("");
  const u = useMemo(() => {
    if (kind === "transfer") {
      const e = getActiveWarehouses();
      const n = o ? getProductStockLevels(o) : null;
      const r = o
        ? [...e].sort(
            (e, t) =>
              Number(n?.locations[t.id] || 0) - Number(n?.locations[e.id] || 0),
          )[0]?.id
        : e[0]?.id;
      return {
        productId: productId || String(listRecords("products")[0]?.id || ""),
        from: r || "",
        to: e.find((e) => e.id !== r)?.id || "",
        quantity: 1,
        status: "Draft",
        date: new Date().toISOString().slice(0, 10),
      };
    }
    const n =
      listRecords("suppliers").find((e) => e.status !== "Paused") ||
      listRecords("suppliers")[0];
    const r = getActiveWarehouses()[0];
    const i = o
      ? Math.max(20, Number(o.threshold || 15) * 3 - Number(o.stock || 0))
      : 20;
    return {
      productId: productId || String(listRecords("products")[0]?.id || ""),
      supplierId: n?.id || "",
      warehouseId: r?.id || "",
      quantity: i,
      unitCost: Number(o?.cost || 0),
      eta: getDateInDays(Number(n?.leadTime || 7)),
      status: "Ordered",
    };
  }, [kind, productId, o]);
  return (
    <AppDialog
      title={
        o
          ? `${kind === "transfer" ? "Transfer" : "Replenish"} ${String(o.name || "")}`
          : kind === "transfer"
            ? "Create stock transfer"
            : "Create replenishment"
      }
      onClose={onClose}
      wide
    >
      <form
        className="c-form inventory-operation-form"
        data-c-form="record"
        data-module={i}
        onSubmit={(t) => {
          t.preventDefault();
          c("");
          try {
            const o = new FormData(t.currentTarget);
            const s = {};
            a.fields.forEach((e) => {
              const t = String(o.get(e.key) || "").trim();
              s[e.key] =
                ["money", "number"].includes(e.type) && t !== ""
                  ? Number(t)
                  : t;
            });
            saveRecord(i, s);
            onClose();
            onChanged();
            showToast(
              kind === "transfer"
                ? "Stock transfer created."
                : "Replenishment created.",
            );
          } catch (e) {
            c(
              e instanceof Error
                ? e.message
                : "This inventory operation could not be saved.",
            );
          }
        }}
      >
        <div className="inventory-dialog-intro">
          <Icon name={kind === "transfer" ? "truck" : "package"} />
          <div>
            <strong>
              {kind === "transfer"
                ? "Move stock between locations"
                : "Plan incoming stock"}
            </strong>
            <p>
              {kind === "transfer"
                ? "Receiving the transfer updates each warehouse balance without changing your global on-hand quantity."
                : "Choose the supplier and receiving location. Marking this replenishment Received later will add the units to inventory automatically."}
            </p>
          </div>
        </div>
        <div className="c-form-grid">
          {a.fields.map((e) => (
            <FormField
              key={e.key}
              field={e}
              value={getInventoryFieldValue(e, u)}
            />
          ))}
        </div>
        <p className="c-form-error" role="alert">
          {s}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            {kind === "transfer" ? "Create transfer" : "Create replenishment"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
