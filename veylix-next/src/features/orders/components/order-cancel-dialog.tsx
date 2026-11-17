// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { findRecord } from "@/lib/store/core";

export function OrderCancelDialog({ orderId, onClose, onConfirm }) {
  const r = findRecord("orders", orderId);
  return r ? (
    <AppDialog
      title={`Cancel order #${String(r.number || "")}`}
      onClose={onClose}
    >
      <div className="order-cancel-confirm">
        <span>
          <Icon name="x" />
        </span>
        <div>
          <h3>Cancel this order?</h3>
          <p>
            The order will stay in order history and a cancellation record will
            be created. Delivered orders should use returns/refunds instead.
          </p>
        </div>
      </div>
      <div className="store-tool-dialog-actions">
        <button type="button" className="secondary-button" onClick={onClose}>
          Keep order
        </button>
        <button
          type="button"
          className="secondary-button product-danger-button"
          onClick={onConfirm}
        >
          <Icon name="x" />
          {" Cancel order"}
        </button>
      </div>
    </AppDialog>
  ) : null;
}
