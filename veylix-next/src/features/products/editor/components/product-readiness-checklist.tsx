// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { ProductEditorSection } from "@/features/products/editor/components/product-editor-section";

export function ProductReadinessChecklist({ values, optionsDirty }) {
  const n = Number(values.minimumSellingPrice || 0);
  const r = Number(values.price || 0);
  const i = [
    ["Product name & SKU", !!(values.name.trim() && values.sku.trim())],
    ["Short description", !!values.shortDescription.trim()],
    ["Cover image", values.mediaIds.length > 0],
    ["Primary category", !!values.category],
    ["Selling price", r > 0 && (!n || r >= n)],
    ["Variant combinations", !optionsDirty],
    ["Search description", !!values.seoDescription.trim()],
    ["Publication status", !!values.status],
  ];
  return (
    <ProductEditorSection
      id="readiness"
      icon="check"
      title="Product checklist"
      description="A quick readiness check before you save."
      className="product-readiness"
    >
      <ul className="product-checklist" data-product-checklist>
        {i.map(([e, t]) => (
          <li key={e} className={t ? "is-complete" : ""}>
            <Icon name={t ? "check-circle" : "circle"} />
            <span>{e}</span>
          </li>
        ))}
      </ul>
    </ProductEditorSection>
  );
}
