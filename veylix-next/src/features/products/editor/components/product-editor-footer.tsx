// @ts-nocheck
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { buildHref } from "@/lib/navigation";

export function ProductEditorFooter({ editing, uploading, currentSection }) {
  return (
    <footer className="product-editor-footer">
      <Link className="secondary-button" href={buildHref("/commerce/products")}>
        Back to products
      </Link>
      <div className="product-editor-footer-status">
        <span data-product-current-section>{currentSection}</span>
        <small>All sections save together as one product.</small>
      </div>
      <button
        type="submit"
        name="intent"
        value="save"
        className="primary-button"
        disabled={uploading}
      >
        <Icon name="check" /> {editing ? "Save product" : "Create product"}
      </button>
    </footer>
  );
}
