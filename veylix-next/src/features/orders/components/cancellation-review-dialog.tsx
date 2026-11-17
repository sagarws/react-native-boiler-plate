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

export function CancellationReviewDialog({ id, onClose, onEdit }) {
  const r = findRecord("cancellations", id);
  const i = r ? findRecord("orders", r.orderId) : void 0;
  const a = getOrderOpsDialogCustomer(i);
  if (!r) return null;
  const o = ["Approved", "Rejected"].includes(String(r.status || ""));
  return (
    <AppDialog
      title={`Cancellation · ${String(i?.number || getRecordLabel("orders", r.orderId))}`}
      onClose={onClose}
      wide
      className="ops-detail-dialog"
    >
      <div className="ops-detail-hero">
        <span>
          <Icon name="x" />
        </span>
        <div>
          <small>{String(a?.name || "Customer unavailable")}</small>
          <h2>{String(r.reason || "Cancellation request")}</h2>
          <p>
            {String(r.requestedBy || "Requested")}
            {" · "}
            {formatOrderOpsDialogDate(r.requestedAt)}
          </p>
        </div>
        <StatusPill value={String(r.status || "")} />
      </div>
      <OrderOpsDetailGrid
        items={[
          [
            "Order status",
            <StatusPill value={String(i?.status || "Unknown")} />,
          ],
          ["Payment", <StatusPill value={String(i?.payment || "Unknown")} />],
          ["Order total", i ? formatCurrency(calculateOrderTotal(i), 2) : "—"],
          ["Liability", String(r.liability || "Under review")],
          ["Inventory action", String(r.inventoryAction || "—")],
          ["Payment action", String(r.refundAction || "—")],
          ["Requested", formatOrderOpsDialogDate(r.requestedAt)],
          ["Decision", formatOrderOpsDialogDate(r.decidedAt)],
        ]}
      />
      <section className="ops-note">
        <h3>Decision note</h3>
        <p>{String(r.notes || "No decision note yet.")}</p>
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
