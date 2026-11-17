// @ts-nocheck
import { ProductEditorSection } from "@/features/products/editor/components/product-editor-section";
import { ProductToggle } from "@/features/products/editor/components/product-toggle";
import {
  htmlToPlainText,
  slugifyProductHandle,
} from "@/features/products/editor/lib/rich-text";

export function ProductSeoSection({ values, setField, hidden }) {
  const r = values.slug || slugifyProductHandle(values.name) || "product-handle";
  const i = values.seoTitle || values.name || "Your product title";
  const a =
    values.seoDescription ||
    values.shortDescription ||
    htmlToPlainText(values.descriptionHtml) ||
    "A clear description helps customers find the right product.";
  return (
    <ProductEditorSection
      id="seo"
      icon="globe"
      title={"SEO & visibility"}
      description="Control search presentation, indexing and storefront availability before publishing."
      panel
      hidden={hidden}
    >
      <div className="product-seo-preview">
        <span data-seo-url>{`yourstore.com / products / ${r}`}</span>
        <strong data-seo-title>{i}</strong>
        <p data-seo-description>{a}</p>
      </div>
      <div className="c-form-grid">
        <label className="c-field" htmlFor="product-seoTitle">
          <span>SEO title</span>
          <input
            id="product-seoTitle"
            name="seoTitle"
            type="text"
            value={values.seoTitle}
            onChange={(e) => setField("seoTitle", e.target.value)}
          />
        </label>
        <label className="c-field" htmlFor="product-slug">
          <span>URL handle</span>
          <input
            id="product-slug"
            name="slug"
            type="text"
            value={values.slug}
            onChange={(e) => setField("slug", e.target.value)}
          />
        </label>
        <label className="c-field span-full" htmlFor="product-seoDescription">
          <span>SEO description</span>
          <textarea
            id="product-seoDescription"
            name="seoDescription"
            rows={4}
            maxLength={170}
            value={values.seoDescription}
            placeholder="Write a concise search description."
            onChange={(e) => setField("seoDescription", e.target.value)}
          />
        </label>
        <label className="c-field span-full" htmlFor="product-seoKeywords">
          <span>SEO keywords</span>
          <input
            id="product-seoKeywords"
            name="seoKeywords"
            type="text"
            value={values.seoKeywords}
            placeholder="keyword one, keyword two"
            onChange={(e) => setField("seoKeywords", e.target.value)}
          />
        </label>
      </div>
      <p className="product-help" data-seo-count>
        {values.seoTitle.length}
        {"/70 title characters · "}
        {values.seoDescription.length}/170 description characters
      </p>
      <section className="product-editor-block product-seo-visibility">
        <div className="product-editor-block-heading">
          <div>
            <h3>Storefront visibility</h3>
            <p>
              Control search indexing, catalog discovery and purchase
              availability.
            </p>
          </div>
        </div>
        <div className="c-form-grid">
          <label className="c-field" htmlFor="product-searchVisibility">
            <span>Search visibility</span>
            <select
              id="product-searchVisibility"
              name="searchVisibility"
              value={values.searchVisibility}
              onChange={(e) => setField("searchVisibility", e.target.value)}
            >
              <option>Index</option>
              <option>Noindex</option>
            </select>
          </label>
          <label className="c-field" htmlFor="product-catalogVisibility">
            <span>Catalog visibility</span>
            <select
              id="product-catalogVisibility"
              name="catalogVisibility"
              value={values.catalogVisibility}
              onChange={(e) => setField("catalogVisibility", e.target.value)}
            >
              {["Everywhere", "Search only", "Catalog only", "Hidden"].map(
                (e) => (
                  <option key={e}>{e}</option>
                ),
              )}
            </select>
          </label>
        </div>
        <div className="product-toggle-grid">
          <ProductToggle
            name="availableForOrder"
            title="Available for order"
            description="Allow customers to purchase after publication."
            checked={values.availableForOrder}
            onChange={(e) => setField("availableForOrder", e)}
          />
          <ProductToggle
            name="showPrice"
            title="Show price"
            description="Display the product price on the storefront."
            checked={values.showPrice}
            onChange={(e) => setField("showPrice", e)}
          />
        </div>
      </section>
      <section className="product-editor-block product-publish-final">
        <div className="product-editor-block-heading">
          <div>
            <span className="product-navigation-eyebrow">FINAL STEP</span>
            <h3>{"Publish & merchandising"}</h3>
            <p>
              Choose the product state only after content, catalog, price, stock
              and SEO are ready.
            </p>
          </div>
          <span className="product-publish-badge">Finish here</span>
        </div>
        <div className="product-publish-controls">
          <label className="c-field" htmlFor="product-status">
            <span>Status</span>
            <select
              id="product-status"
              name="status"
              value={values.status}
              onChange={(e) => setField("status", e.target.value)}
            >
              {["Active", "Draft", "Archived"].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <ProductToggle
            name="featured"
            title="Featured product"
            description="Include this product in featured merchandising and curated storefront sections."
            checked={values.featured}
            onChange={(e) => setField("featured", e)}
          />
        </div>
        <div className="product-publish-note">
          <span>✓</span>
          <span>
            Draft keeps the product private. Choose Active when the product is
            ready for shoppers.
          </span>
        </div>
      </section>
    </ProductEditorSection>
  );
}
