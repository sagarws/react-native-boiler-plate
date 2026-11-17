// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { getStorefrontSnapshot } from "@/features/online-store/lib/store-tools";

export function StorefrontPreviewDialog({ onClose }) {
  const t = getStorefrontSnapshot();
  return (
    <AppDialog title="Storefront preview" onClose={onClose}>
      <div className="store-preview-card">
        <span className="storefront-command-mark">
          <Icon name="storefront" />
        </span>
        <div>
          <small>LIVE STOREFRONT PREVIEW</small>
          <h3>{String(t.general.storeName || "Veylix")}</h3>
          <p>{String(t.domain.domain || "Domain not connected")}</p>
        </div>
      </div>
      <div className="store-preview-grid">
        <div>
          <span>Products</span>
          <strong>{t.activeProducts}</strong>
        </div>
        <div>
          <span>Published content</span>
          <strong>{t.publishedContent}</strong>
        </div>
        <div>
          <span>SSL</span>
          <strong>{String(t.domain.ssl || "Not configured")}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{String(t.maintenance.mode || "Online")}</strong>
        </div>
      </div>
      <p>
        This preview summarizes the current storefront setup so you can review
        the important customer-facing configuration at a glance.
      </p>
    </AppDialog>
  );
}
