// @ts-nocheck
import { AppDialog } from "@/components/ui/app-dialog";
import { ShipmentStatusPill } from "@/features/orders/components/shipment-badges";
import {
  formatShippingDate,
  getShipmentCustomer,
  getShipmentOrder,
} from "@/features/orders/lib/shipping";
import { formatCurrency } from "@/lib/format";
import { findRecord, getRecordLabel } from "@/lib/store/core";

export function PackingSlipDialog({ id, onClose }) {
  const n = findRecord("fulfillment", id);
  if (!n) return null;
  const r = getShipmentOrder(n);
  const i = getShipmentCustomer(r);
  const a = Array.isArray(r?.items) ? r?.items : [];
  return (
    <AppDialog
      title={`Packing slip · #${String(r?.number || "Order")}`}
      onClose={onClose}
      wide
      className="packing-slip-dialog"
    >
      <div className="packing-slip">
        <header>
          <div>
            <small>VEYLIX FULFILLMENT</small>
            <h2>#{String(r?.number || "—")}</h2>
          </div>
          <ShipmentStatusPill value={n.status} />
        </header>
        <div className="packing-slip-grid">
          <div>
            <span>Customer</span>
            <strong>{String(i?.name || "Customer")}</strong>
            <small>{String(r?.shippingAddress || i?.address || "—")}</small>
          </div>
          <div>
            <span>Warehouse</span>
            <strong>{getRecordLabel("warehouses", n.warehouseId)}</strong>
            <small>{String(n.pickWave || "No pick wave")}</small>
          </div>
          <div>
            <span>Carrier</span>
            <strong>{String(n.carrier || "Not assigned")}</strong>
            <small>{String(n.service || "Service pending")}</small>
          </div>
          <div>
            <span>Package</span>
            <strong>{String(n.packageType || "Package pending")}</strong>
            <small>
              {n.weight ? `${String(n.weight)} kg` : "Weight pending"}
            </small>
          </div>
        </div>
        <section>
          <h3>Items to pack</h3>
          {a.length ? (
            a.map((e, t) => (
              <div
                key={`${String(e.productId || "item")}-${t}`}
                className="packing-slip-item"
              >
                <span>
                  <strong>{getRecordLabel("products", e.productId)}</strong>
                  <small>
                    {String(e.quantity || 0)}
                    {" × "}
                    {formatCurrency(Number(e.unitPrice || 0), 2)}
                  </small>
                </span>
                <strong>{String(e.quantity || 0)}</strong>
              </div>
            ))
          ) : (
            <p>No line items available.</p>
          )}
        </section>
        {r?.notes ? (
          <section className="packing-slip-note">
            <h3>Order note</h3>
            <p>{String(r.notes)}</p>
          </section>
        ) : null}
        <footer>
          <span>
            {"Ship by "}
            {formatShippingDate(n.shipBy)}
          </span>
          <strong>{String(n.tracking || "Tracking not assigned")}</strong>
        </footer>
      </div>
    </AppDialog>
  );
}
