// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import {
  findProductById,
  formatProductUpdatedAt,
} from "@/features/products/lib/product-helpers";
import { getProductActivity } from "@/lib/store/products";

export function ProductActivityDialog({ productId, onClose }) {
  const n = findProductById(productId);
  if (!n) return null;
  const r = getProductActivity(productId);
  return (
    <AppDialog title={`${String(n.name || "")} activity`} onClose={onClose}>
      {r.length ? (
        <div className="product-activity-list">
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
        </div>
      ) : (
        <div className="c-empty">
          <Icon name="history" />
          <h3>No activity yet</h3>
          <p>This demo product has not been changed in this browser yet.</p>
        </div>
      )}
    </AppDialog>
  );
}
