// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { formatOrderDialogDate } from "@/features/orders/components/order-detail-dialog";
import { formatProductUpdatedAt } from "@/features/products/lib/product-helpers";
import { findRecord, listRecords } from "@/lib/store/core";
import { getOrderActivity } from "@/lib/store/orders";

export function OrderActivityDialog({ orderId, onClose }) {
  const n =
    findRecord("orders", orderId) ||
    listRecords("orders", {
      archived: true,
    }).find((t) => t.id === orderId);
  if (!n) return null;
  const r = getOrderActivity(orderId);
  return (
    <AppDialog title={`#${String(n.number || "")} activity`} onClose={onClose}>
      <div className="product-activity-list order-activity-list">
        {r.map((e) => (
          <div key={e.id} className="product-activity-item">
            <span>
              <Icon name="history" />
            </span>
            <div>
              <strong>{String(e.action || "")}</strong>
              <small>
                {String(e.actor || "Local demo")}
                {" · "}
                {formatProductUpdatedAt({
                  id: e.id,
                  updatedAt: e.date,
                })}
              </small>
            </div>
          </div>
        ))}
        <div className="product-activity-item">
          <span>
            <Icon name="clipboard-text" />
          </span>
          <div>
            <strong>Order placed</strong>
            <small>
              {String(n.channel || "Online store")}
              {" · "}
              {formatOrderDialogDate(n.date)}
            </small>
          </div>
        </div>
      </div>
    </AppDialog>
  );
}
