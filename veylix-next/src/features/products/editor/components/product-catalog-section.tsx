// @ts-nocheck
import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { ProductEditorSection } from "@/features/products/editor/components/product-editor-section";
import { splitUniqueCommaList } from "@/features/products/editor/lib/rich-text";
import { formatCurrency } from "@/lib/format";
import { buildHref } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";

function flattenCategoryTree(e) {
  const t = e.filter((e) => !e.parent || e.parent === "None");
  const n = e.filter((e) => e.parent && e.parent !== "None");
  const r = [];
  t.forEach((e) => {
    r.push({
      ...e,
      depth: 0,
    });
    n.filter((t) => t.parent === e.name).forEach((e) =>
      r.push({
        ...e,
        depth: 1,
      }),
    );
  });
  n.filter((e) => !t.some((t) => t.name === e.parent)).forEach((e) =>
    r.push({
      ...e,
      depth: 1,
    }),
  );
  return r;
}

export function ProductCatalogSection({ values, setField, productId, hidden }) {
  const [i, a] = useState("");
  const [o, s] = useState("");
  const [c, u] = useState("");
  const d = useMemo(() => listRecords("categories"), []);
  const f = useMemo(() => listRecords("products"), []);
  const p = useMemo(() => listRecords("brands"), []);
  const m = useMemo(() => listRecords("vendors"), []);
  const h = useMemo(() => listRecords("collections"), []);
  const g = useMemo(
    () => listRecords("tags").filter((e) => e.status !== "Hidden"),
    [],
  );
  const _ = useMemo(
    () => listRecords("attributes").filter((e) => e.status !== "Disabled"),
    [],
  );
  const v = useMemo(() => flattenCategoryTree(d), [d]);
  const y = useMemo(() => {
    const e = new Map();
    f.forEach((t) => {
      (Array.isArray(t.categories) && t.categories.length
        ? t.categories
        : [t.category]
      )
        .filter(Boolean)
        .forEach((t) => e.set(String(t), Number(e.get(String(t)) || 0) + 1));
    });
    return e;
  }, [f]);
  const b = values.categories.length
    ? values.categories
    : values.category
      ? [values.category]
      : [];
  const x = (n) => {
    const r = [...new Set(n)];
    setField("categories", r);
    if (!r.includes(values.category)) {
      setField("category", r[0] || "");
    }
  };
  const S = splitUniqueCommaList(values.collections);
  const C = () => {
    const n = _.find((e) => e.id === c);
    if (n && !values.productAttributes.some((e) => e.attributeId === n.id)) {
      setField("productAttributes", [
        ...values.productAttributes,
        {
          attributeId: n.id,
          name: String(n.name || ""),
          values: [],
        },
      ]);
      u("");
    }
  };
  const w = (n, r) =>
    setField(
      "productAttributes",
      values.productAttributes.map((e) => (e.attributeId === n ? r(e) : e)),
    );
  const T = f.filter(
    (e) =>
      e.id !== productId &&
      (!o ||
        [e.name, e.sku, e.category]
          .join(" ")
          .toLowerCase()
          .includes(o.toLowerCase())),
  );
  return (
    <ProductEditorSection
      id="catalog"
      icon="squares-four"
      title={"Catalog & organization"}
      description="Organize categories, brand, seller, attributes, merchandising and related products."
      panel
      hidden={hidden}
    >
      <section className="product-editor-block product-category-workspace">
        <div className="product-editor-block-heading">
          <div>
            <h3>Categories</h3>
            <p>
              Associate several categories and choose one primary category for
              navigation and reporting.
            </p>
          </div>
          <span className="product-block-badge">
            {b.length}
            {" selected"}
          </span>
        </div>
        <input type="hidden" name="category" value={values.category} readOnly />
        <input
          type="hidden"
          name="categories"
          value={JSON.stringify(b)}
          readOnly
        />
        <div className="product-category-layout">
          <div>
            <label className="product-inline-search">
              <Icon name="search" />
              <input
                type="search"
                value={i}
                onChange={(e) => a(e.target.value)}
                placeholder="Search categories"
                aria-label="Search categories"
              />
            </label>
            <div className="product-category-list">
              {v
                .filter(
                  (e) =>
                    !i ||
                    `${e.name} ${e.parent || ""}`
                      .toLowerCase()
                      .includes(i.toLowerCase()),
                )
                .map((n) => {
                  const r = String(n.name || "");
                  const i = b.includes(r);
                  return (
                    <label key={n.id} className="product-category-option">
                      <span className="product-category-selectors">
                        <input
                          type="checkbox"
                          checked={i}
                          onChange={(e) =>
                            x(
                              e.target.checked
                                ? [...b, r]
                                : b.filter((e) => e !== r),
                            )
                          }
                          aria-label={`Select ${r}`}
                        />
                        <input
                          type="radio"
                          name="primary-category-picker"
                          checked={values.category === r}
                          disabled={!i}
                          onChange={() => setField("category", r)}
                          aria-label={`Make ${r} the primary category`}
                        />
                      </span>
                      <span
                        className={`product-category-copy${n.depth ? " is-child" : ""}`}
                      >
                        <strong>
                          {n.depth ? "↳ " : ""}
                          {r}
                        </strong>
                        <small>
                          {n.depth
                            ? String(n.parent || "")
                            : "Top-level category"}
                          {" · "}
                          {y.get(r) || 0}
                          {" product"}
                          {(y.get(r) || 0) === 1 ? "" : "s"}
                        </small>
                      </span>
                    </label>
                  );
                })}
            </div>
          </div>
          <aside className="product-category-selected">
            <strong>Selected categories</strong>
            <div>
              {b.length ? (
                b.map((t) => (
                  <span key={t}>
                    {t}
                    {t === values.category ? <em>Primary</em> : null}
                  </span>
                ))
              ) : (
                <p>No categories selected.</p>
              )}
            </div>
          </aside>
        </div>
      </section>
      <section className="product-editor-block">
        <div className="product-editor-block-heading">
          <div>
            <h3>{"Brand, tags & seller details"}</h3>
            <p>
              Keep merchandising ownership and reusable discovery labels
              connected to the product.
            </p>
          </div>
        </div>
        <div className="c-form-grid product-catalog-details">
          <label className="c-field" htmlFor="product-brand">
            <span>Brand</span>
            <select
              id="product-brand"
              name="brand"
              value={values.brand}
              onChange={(e) => setField("brand", e.target.value)}
            >
              <option value="">No brand</option>
              {p.map((e) => (
                <option key={e.id} value={String(e.name || "")}>
                  {String(e.name || "")}
                </option>
              ))}
            </select>
          </label>
          <label className="c-field" htmlFor="product-vendor">
            <span>Seller / vendor</span>
            <select
              id="product-vendor"
              name="vendor"
              value={values.vendor}
              onChange={(e) => setField("vendor", e.target.value)}
            >
              <option value="">No seller / owner product</option>
              {[
                ...new Set(
                  [values.vendor, ...m.map((e) => String(e.name || ""))].filter(
                    Boolean,
                  ),
                ),
              ].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-field" htmlFor="product-productType">
            <span>Product type</span>
            <select
              id="product-productType"
              name="productType"
              value={values.productType}
              onChange={(e) => setField("productType", e.target.value)}
            >
              <option>Physical</option>
              <option>Digital</option>
            </select>
          </label>
          <label className="c-field" htmlFor="product-tags">
            <span>Tags</span>
            <input
              id="product-tags"
              name="tags"
              type="text"
              value={values.tags}
              placeholder="e.g. Bestseller, Sustainable"
              onChange={(e) => setField("tags", e.target.value)}
            />
            <small className="product-field-hint">
              Separate tags with commas.
            </small>
          </label>
        </div>
        <div className="product-tag-suggestions" aria-label="Suggested tags">
          <span>Suggested</span>
          {g.slice(0, 10).map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() =>
                setField(
                  "tags",
                  splitUniqueCommaList(
                    `${values.tags}, ${String(n.name || "")}`,
                  ).join(", "),
                )
              }
            >
              {String(n.name || "")}
            </button>
          ))}
        </div>
        <div className="product-collection-picker">
          <div>
            <strong>Collections</strong>
            <small>Place this product in manual merchandising groups.</small>
          </div>
          <input
            type="hidden"
            name="collections"
            value={S.join(", ")}
            readOnly
          />
          <div>
            {h.length ? (
              h.map((e) => {
                const n = String(e.name || "");
                const r = S.includes(n);
                return (
                  <label key={e.id}>
                    <input
                      type="checkbox"
                      checked={r}
                      onChange={(e) =>
                        setField(
                          "collections",
                          (e.target.checked
                            ? [...S, n]
                            : S.filter((e) => e !== n)
                          ).join(", "),
                        )
                      }
                    />
                    <span>{n}</span>
                  </label>
                );
              })
            ) : (
              <p>No collections have been created yet.</p>
            )}
          </div>
        </div>
      </section>
      <section className="product-editor-block">
        <div className="product-editor-block-heading product-editor-block-heading-actions">
          <div>
            <h3>Product attributes</h3>
            <p>
              Select reusable global attributes and the values that describe
              this product.
            </p>
          </div>
          <Link
            className="secondary-button"
            href={buildHref("/commerce/attributes")}
          >
            Manage global attributes
          </Link>
        </div>
        <input
          type="hidden"
          name="productAttributes"
          value={JSON.stringify(values.productAttributes)}
          readOnly
        />
        <div className="product-attribute-adder">
          <select
            value={c}
            onChange={(e) => u(e.target.value)}
            aria-label="Choose a global attribute"
          >
            <option value="">Choose an attribute</option>
            {_.map((t) => (
              <option
                key={t.id}
                value={t.id}
                disabled={values.productAttributes.some(
                  (e) => e.attributeId === t.id,
                )}
              >
                {String(t.name || "")}
              </option>
            ))}
          </select>
          <button type="button" className="secondary-button" onClick={C}>
            <Icon name="plus" />
            {" Add attribute"}
          </button>
        </div>
        <div className="product-attribute-list">
          {values.productAttributes.length ? (
            values.productAttributes.map((n) => {
              const r =
                _.find((e) => e.id === n.attributeId) ||
                _.find((e) => e.name === n.name);
              const i = String(r?.values || "")
                .split(",")
                .map((e) => e.trim())
                .filter(Boolean);
              return (
                <article key={n.attributeId} className="product-attribute-card">
                  <header>
                    <div>
                      <strong>
                        {String(r?.name || n.name || "Attribute")}
                      </strong>
                      <small>{String(r?.purpose || "Product detail")}</small>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${String(r?.name || n.name || "attribute")}`}
                      onClick={() =>
                        setField(
                          "productAttributes",
                          values.productAttributes.filter(
                            (e) => e.attributeId !== n.attributeId,
                          ),
                        )
                      }
                    >
                      <Icon name="trash" />
                    </button>
                  </header>
                  <div className="product-attribute-values">
                    {i.map((e) => (
                      <label key={e}>
                        <input
                          type="checkbox"
                          checked={n.values.includes(e)}
                          onChange={(t) =>
                            w(n.attributeId, (n) => ({
                              ...n,
                              values: t.target.checked
                                ? [...n.values, e]
                                : n.values.filter((t) => t !== e),
                            }))
                          }
                        />
                        <span>{e}</span>
                      </label>
                    ))}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="product-empty-options">
              No product attributes selected. Add a reusable attribute such as
              Material, Finish or Capacity.
            </div>
          )}
        </div>
      </section>
      <section className="product-editor-block">
        <div className="product-editor-block-heading">
          <div>
            <h3>Related products</h3>
            <p>
              Select products to recommend together on the product detail page.
            </p>
          </div>
          <span className="product-block-badge">
            {values.relatedProductIds.length}
            {" selected"}
          </span>
        </div>
        <input
          type="hidden"
          name="relatedProductIds"
          value={JSON.stringify(values.relatedProductIds)}
          readOnly
        />
        <label className="product-inline-search">
          <Icon name="search" />
          <input
            type="search"
            value={o}
            onChange={(e) => s(e.target.value)}
            placeholder="Search related products"
            aria-label="Search related products"
          />
        </label>
        <div className="product-related-list">
          {T.length ? (
            T.map((n) => {
              const r = values.relatedProductIds.includes(n.id);
              return (
                <label key={n.id} className="product-related-row">
                  <input
                    type="checkbox"
                    checked={r}
                    onChange={(r) =>
                      setField(
                        "relatedProductIds",
                        r.target.checked
                          ? [...values.relatedProductIds, n.id]
                          : values.relatedProductIds.filter((e) => e !== n.id),
                      )
                    }
                  />
                  <span className="product-related-icon">
                    <Icon name="package" />
                  </span>
                  <span>
                    <strong>{String(n.name || "")}</strong>
                    <small>
                      {String(n.sku || "No SKU")}
                      {" · "}
                      {String(n.category || "Uncategorized")}
                      {" · "}
                      {formatCurrency(Number(n.price || 0), 2)}
                    </small>
                  </span>
                </label>
              );
            })
          ) : (
            <p className="product-empty-options">
              Add another product to start building recommendations.
            </p>
          )}
        </div>
      </section>
    </ProductEditorSection>
  );
}
