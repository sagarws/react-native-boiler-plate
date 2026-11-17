// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { renderInventoryOperationThumb } from "@/features/inventory/components/inventory-operation-dialog";
import {
  getActiveWarehouses,
  getProductStockLevels,
} from "@/features/inventory/lib/stock-levels";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";

export function InventoryDetailDialog({
  productId,
  onClose,
  onAdjust,
  onTransfer,
  onReplenish,
  onHistory,
}) {
  const o = findRecord("products", productId);
  if (!o) return null;
  const s = getProductStockLevels(o);
  const c = getActiveWarehouses();
  const l = listRecords("replenishment").filter(
    (e) => e.productId === o.id && e.status === "Ordered",
  );
  const u =
    s.status === "Healthy"
      ? "green"
      : s.status === "Low stock"
        ? "amber"
        : s.status === "Out of stock"
          ? "red"
          : "blue";
  return (
    <AppDialog
      title={`${String(o.name || "")} inventory`}
      onClose={onClose}
      wide
    >
      <div className="inventory-detail-hero">
        {renderInventoryOperationThumb(o)}
        <div>
          <span className="product-mono">{String(o.sku || "")}</span>
          <h3>{String(o.name || "")}</h3>
          <p>
            {String(o.category || "Uncategorized")}
            {" · "}
            {String(o.brand || "No brand")}
          </p>
        </div>
        <span className={`inventory-status ${u}`}>
          <i />
          {s.status}
        </span>
      </div>
      <div className="inventory-detail-metrics">
        <div>
          <small>On hand</small>
          <strong>{s.onHand}</strong>
        </div>
        <div>
          <small>Committed</small>
          <strong>{s.committed}</strong>
        </div>
        <div>
          <small>Incoming</small>
          <strong>{s.incoming}</strong>
        </div>
        <div>
          <small>Available</small>
          <strong>{s.available}</strong>
        </div>
      </div>
      <section className="inventory-detail-panel">
        <div className="inventory-detail-heading">
          <strong>Location balances</strong>
          <small>
            {c.length}
            {" active locations"}
          </small>
        </div>
        {c.map((e) => (
          <div key={e.id} className="inventory-detail-location">
            <span>
              <Icon name="warehouse" />
            </span>
            <div>
              <strong>{String(e.name || "")}</strong>
              <small>
                {String(e.code || "Location")}
                {" · "}
                {String(e.type || "Inventory location")}
              </small>
            </div>
            <em>
              {Number(s.locations[e.id] || 0)}
              {" units"}
            </em>
          </div>
        ))}
      </section>
      <section className="inventory-detail-panel">
        <div className="inventory-detail-heading">
          <strong>Incoming purchase stock</strong>
          <small>
            {l.length}
            {" open replenishment"}
            {l.length === 1 ? "" : "s"}
          </small>
        </div>
        {l.length ? (
          l.map((e) => (
            <div key={e.id} className="inventory-incoming-row">
              <span>
                <Icon name="truck" />
              </span>
              <div>
                <strong>
                  {Number(e.quantity || 0)}
                  {" units · "}
                  {getRecordLabel("warehouses", e.warehouseId)}
                </strong>
                <small>
                  {getRecordLabel("suppliers", e.supplierId)}
                  {" · ETA "}
                  {String(e.eta || "TBD")}
                </small>
              </div>
            </div>
          ))
        ) : (
          <p className="inventory-detail-empty">
            No confirmed incoming stock for this product.
          </p>
        )}
      </section>
      <div className="button-row inventory-detail-actions">
        <button className="primary-button" type="button" onClick={onAdjust}>
          Adjust stock
        </button>
        <button className="secondary-button" type="button" onClick={onTransfer}>
          Create transfer
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={onReplenish}
        >
          Replenish
        </button>
        <button className="secondary-button" type="button" onClick={onHistory}>
          View history
        </button>
      </div>
    </AppDialog>
  );
}
