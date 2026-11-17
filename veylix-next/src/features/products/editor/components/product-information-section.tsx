// @ts-nocheck
import { ProductEditorSection } from "@/features/products/editor/components/product-editor-section";
import { ProductRichTextField } from "@/features/products/editor/components/product-rich-text-field";

export function ProductInformationSection({
  values,
  setField,
  hidden = false,
}) {
  return (
    <ProductEditorSection
      id="information"
      icon="package"
      title="Product information"
      description="Create polished customer-facing product content with structured rich text."
      panel
      hidden={hidden}
    >
      <div className="product-information-grid">
        <div className="c-form-grid product-information-core">
          <label className="c-field" htmlFor="product-name">
            <span>
              {"Product name "}
              <small>*</small>
            </span>
            <input
              id="product-name"
              name="name"
              type="text"
              required
              value={values.name}
              placeholder="e.g. Everyday linen shirt"
              onChange={(e) => setField("name", e.target.value)}
            />
          </label>
          <label className="c-field" htmlFor="product-sku">
            <span>
              {"SKU "}
              <small>*</small>
            </span>
            <input
              id="product-sku"
              name="sku"
              type="text"
              required
              value={values.sku}
              onChange={(e) => setField("sku", e.target.value)}
            />
          </label>
          <label
            className="c-field span-full"
            htmlFor="product-short-description"
          >
            <span>Short description</span>
            <textarea
              id="product-short-description"
              name="shortDescription"
              rows={3}
              maxLength={260}
              value={values.shortDescription}
              placeholder="A concise product summary for cards, lists and quick previews."
              onChange={(e) => setField("shortDescription", e.target.value)}
            />
            <small className="product-field-hint">
              Recommended: 160–220 characters.
            </small>
          </label>
        </div>
        <ProductRichTextField
          value={values.descriptionHtml}
          onChange={(e) => setField("descriptionHtml", e)}
        />
      </div>
    </ProductEditorSection>
  );
}
