// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import {
  formatShippingDate,
  getShipmentOrder,
} from "@/features/orders/lib/shipping";
import { navigate } from "@/lib/navigation";
import { findRecord } from "@/lib/store/core";

export function DeliveryExceptionDialog({ id, onClose, onEdit }) {
  const r = findRecord("deliveries", id);
  if (!r) return null;
  const i = getShipmentOrder(r);
  return (
    <AppDialog
      title={`Delivery exception · #${String(i?.number || "Order")}`}
      onClose={onClose}
    >
      <div className="delivery-exception-dialog">
        <span className="delivery-exception-icon">
          <Icon name="info" />
        </span>
        <h2>{String(r.exceptionType || "Shipment exception")}</h2>
        <p>
          {String(
            r.exceptionNote || "No additional exception note is available.",
          )}
        </p>
        <dl>
          <div>
            <dt>Carrier</dt>
            <dd>{String(r.courier || "—")}</dd>
          </div>
          <div>
            <dt>Tracking</dt>
            <dd>{String(r.tracking || "—")}</dd>
          </div>
          <div>
            <dt>Milestone</dt>
            <dd>{String(r.milestone || "—")}</dd>
          </div>
          <div>
            <dt>Expected delivery</dt>
            <dd>{formatShippingDate(r.eta)}</dd>
          </div>
        </dl>
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              navigate(
                `/commerce/orders?q=${encodeURIComponent(String(i?.number || ""))}`,
              )
            }
          >
            Open order
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onEdit(id)}
          >
            Edit tracking
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
