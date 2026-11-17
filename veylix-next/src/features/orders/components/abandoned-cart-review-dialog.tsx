// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { OrderOpsDetailGrid } from "@/features/orders/components/order-ops-detail-grid";
import { formatOrderOpsDialogDate } from "@/features/orders/lib/order-operations-dialog";
import { formatCurrency } from "@/lib/format";
import { navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel } from "@/lib/store/core";

export function AbandonedCartReviewDialog({ id, onClose, onAdvance }) {
  const r = findRecord("abandoned", id);
  if (!r) return null;
  const i = ["Recovered", "Expired"].includes(String(r.status || ""));
  return (
    <AppDialog
      title={`Recovery · ${String(r.checkoutRef || r.id)}`}
      onClose={onClose}
      wide
      className="ops-detail-dialog"
    >
      <div className="ops-detail-hero">
        <span>
          <Icon name="cart" />
        </span>
        <div>
          <small>
            {String(
              getRecordLabel("customers", r.customerId) ||
                r.email ||
                "Guest checkout",
            )}
          </small>
          <h2>{formatCurrency(Number(r.value || 0), 2)}</h2>
          <p>{String(r.items || `${Number(r.itemCount || 0)} items`)}</p>
        </div>
        <StatusPill value={String(r.status || "")} />
      </div>
      <OrderOpsDetailGrid
        items={[
          ["Channel", String(r.channel || "—")],
          ["Source", String(r.source || "—")],
          ["Recovery stage", String(r.recoveryStage || "No outreach")],
          ["Incentive", String(r.incentive || "None")],
          ["Last contact", formatOrderOpsDialogDate(r.lastContact)],
          ["Next action", formatOrderOpsDialogDate(r.nextAction)],
          [
            "Recovered order",
            String(getRecordLabel("orders", r.recoveredOrderId) || "—"),
          ],
          ["Created", formatOrderOpsDialogDate(r.date)],
        ]}
      />
      <div className="button-row">
        {r.customerId ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              navigate(
                `/commerce/customers?q=${encodeURIComponent(String(getRecordLabel("customers", r.customerId) || r.customerId))}`,
              )
            }
          >
            Open customer
          </button>
        ) : null}
        {i ? null : (
          <button type="button" className="primary-button" onClick={onAdvance}>
            Advance recovery
          </button>
        )}
      </div>
    </AppDialog>
  );
}
