// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { findProductById } from "@/features/products/lib/product-helpers";
import { showToast } from "@/lib/events";
import { archiveRecords } from "@/lib/store/records";

export function ProductDeleteDialog({ productId, onClose, onDeleted }) {
  const r = findProductById(productId);
  return r ? (
    <AppDialog title="Delete product" onClose={onClose}>
      <div className="product-delete-confirm">
        <span>
          <Icon name="trash" />
        </span>
        <div>
          <h3>
            {"Delete "}
            {String(r.name || "")}?
          </h3>
          <p>
            The product will leave the active catalog and its variants will be
            archived. Historical orders keep their product reference, and you
            can restore it from Deleted products.
          </p>
        </div>
      </div>
      <div className="store-tool-dialog-actions">
        <button type="button" className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="secondary-button product-danger-button"
          data-c-action="product-delete-confirm"
          data-id={r.id}
          onClick={() => {
            archiveRecords("products", [r.id]);
            onDeleted();
            onClose();
            showToast("Product moved to Deleted products.");
          }}
        >
          <Icon name="trash" />
          {" Delete product"}
        </button>
      </div>
    </AppDialog>
  ) : null;
}
