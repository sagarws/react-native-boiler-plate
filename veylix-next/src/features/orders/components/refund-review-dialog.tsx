// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { OrderOpsDetailGrid } from "@/features/orders/components/order-ops-detail-grid";
import {
  formatOrderOpsDialogDate,
  getOrderOpsDialogCustomer,
} from "@/features/orders/lib/order-operations-dialog";
import { formatCurrency } from "@/lib/format";
import { navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";

export function RefundReviewDialog({ id, onClose, onEdit }) {
  const r = findRecord("refunds", id);
  const i = r ? findRecord("orders", r.orderId) : void 0;
  const a = getOrderOpsDialogCustomer(i);
  if (!r) return null;
  const o = ["Completed", "Rejected"].includes(String(r.status || ""));
  return (
    <AppDialog
      title={`Refund · ${String(i?.number || getRecordLabel("orders", r.orderId))}`}
      onClose={onClose}
      wide
      className="ops-detail-dialog"
    >
      <div className="ops-detail-hero">
        <span>
          <Icon name="arrow-left" />
        </span>
        <div>
          <small>{String(a?.name || "Customer unavailable")}</small>
          <h2>{formatCurrency(Number(r.amount || 0), 2)}</h2>
          <p>
            {String(r.reason || "Refund request")}
            {" · "}
            {String(r.requestedBy || "Requested")}
          </p>
        </div>
        <StatusPill value={String(r.status || "")} />
      </div>
      <OrderOpsDetailGrid
        items={[
          ["Order total", i ? formatCurrency(calculateOrderTotal(i), 2) : "—"],
          ["Payment", String(i?.payment || "—")],
          ["Liability", String(r.liability || "Under review")],
          ["Refund method", String(r.refundMethod || "—")],
          [
            "Provider",
            <StatusPill value={String(r.providerStatus || "Not started")} />,
          ],
          ["Inventory", String(r.inventoryAction || "—")],
          ["Requested", formatOrderOpsDialogDate(r.requestedAt)],
          ["Processed", formatOrderOpsDialogDate(r.processedAt)],
        ]}
      />
      <section className="ops-note">
        <h3>Operations note</h3>
        <p>{String(r.notes || "No internal note yet.")}</p>
      </section>
      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            navigate(
              `/commerce/orders?q=${encodeURIComponent(String(i?.number || getRecordLabel("orders", r.orderId)))}`,
            )
          }
        >
          Open order
        </button>
        {o ? null : (
          <button type="button" className="primary-button" onClick={onEdit}>
            Edit request
          </button>
        )}
      </div>
    </AppDialog>
  );
}
