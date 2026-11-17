// @ts-nocheck
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { buildHref } from "@/lib/navigation";

export function ProductEditorHeader({ editing, uploading }) {
  return (
    <header className="commerce-heading">
      <div>
        <Link className="product-back" href={buildHref("/commerce/products")}>
          <Icon name="arrow-left" />
          {" Back to products"}
        </Link>
        <h1>
          {editing ? "Edit product" : "Add product"}
          <span>.</span>
        </h1>
      </div>
      <div className="commerce-heading-actions">
        <button
          type="submit"
          name="intent"
          value="draft"
          className="secondary-button"
          formNoValidate
          disabled={uploading}
        >
          <Icon name="floppy-disk" />
          {" Save draft"}
        </button>
        <button
          type="submit"
          name="intent"
          value="save"
          className="primary-button"
          disabled={uploading}
        >
          <Icon name="check" /> {editing ? "Save product" : "Create product"}
        </button>
      </div>
    </header>
  );
}
