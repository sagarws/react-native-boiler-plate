// @ts-nocheck
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { modulesById } from "@/config/modules/registry";
import { showToast } from "@/lib/events";
import { findRecord, listRecords } from "@/lib/store/core";
import { saveCategory } from "@/lib/store/products";

const categoriesModule = modulesById.categories;

function getCategoryField(e) {
  return categoriesModule.fields.find((t) => t.key === e);
}

function slugifyCategoryName(e) {
  return e
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CategoryEditorDialog({
  recordId,
  presetParent = "None",
  onClose,
  onSaved,
}) {
  const i = useMemo(
    () => (recordId ? findRecord("categories", recordId) : void 0),
    [recordId],
  );
  const a = useMemo(
    () =>
      listRecords("categories").filter(
        (t) => (!t.parent || t.parent === "None") && t.id !== recordId,
      ),
    [recordId],
  );
  const [o, s] = useState("");
  const [c, u] = useState(String(i?.name || ""));
  const [d, f] = useState(String(i?.description || ""));
  const [p, m] = useState(String(i?.seoTitle || ""));
  const [h, g] = useState(String(i?.seoDescription || ""));
  const [_, v] = useState(String(i?.slug || ""));
  const y = useRef(!!i?.slug);
  if (recordId && !i) return null;
  const b = String(i?.parent || presetParent || "None");
  const x = String(i?.seoIndex || "Index");
  const S = recordId
    ? `Edit ${String(i?.name || "category")}`
    : presetParent === "None"
      ? "Add category"
      : `Add sub-category to ${presetParent}`;
  const C = _.trim() || slugifyCategoryName(c) || "category-name";
  const w = p.trim() || c.trim() || "Category name";
  const T =
    h.trim() ||
    d.trim() ||
    "Add a meta description to preview how this category could appear in search results.";
  const E = (e) => {
    u(e);
    if (!y.current) {
      v(slugifyCategoryName(e));
    }
  };
  return (
    <AppDialog
      title={S}
      onClose={onClose}
      wide
      className="category-editor-dialog category-editor-dialog-advanced"
    >
      <form
        className="c-form category-record-form category-advanced-form"
        data-c-form="record"
        data-module="categories"
        data-id={recordId || ""}
        onSubmit={(t) => {
          t.preventDefault();
          s("");
          try {
            const a = new FormData(t.currentTarget);
            const o = {};
            categoriesModule.fields.forEach((e) => {
              o[e.key] = String(a.get(e.key) || "").trim();
            });
            const s = i
              ? {
                  ...i,
                }
              : void 0;
            const c = saveCategory(o, recordId || void 0);
            onClose();
            onSaved(c, s);
            showToast(recordId ? "Category updated." : "Category added.");
          } catch (e) {
            s(
              e instanceof Error
                ? e.message
                : "This category could not be saved.",
            );
          }
        }}
      >
        <section className="category-editor-section">
          <div className="category-editor-section-head">
            <span>
              <Icon name="tag" />
            </span>
            <div>
              <small>CATALOG CONTENT</small>
              <h3>Category details</h3>
              <p>
                Name the browsing group, place it in the hierarchy and describe
                what shoppers will find.
              </p>
            </div>
          </div>
          <div className="c-form-grid category-editor-main-grid">
            <label className="c-field" htmlFor="category-name">
              <span>
                {"Name "}
                <small>*</small>
              </span>
              <input
                id="category-name"
                name="name"
                type="text"
                value={c}
                maxLength={120}
                required
                placeholder="Category name"
                onChange={(e) => E(e.target.value)}
              />
            </label>
            <label className="c-field" htmlFor="category-parent">
              <span>Parent category</span>
              <select id="category-parent" name="parent" defaultValue={b}>
                <option value="None">None · top-level category</option>
                {a.map((e) => (
                  <option key={e.id} value={String(e.name || "")}>
                    {String(e.name || "")}
                  </option>
                ))}
              </select>
              <small className="category-field-help">
                Keep the catalog easy to browse with one level of
                sub-categories.
              </small>
            </label>
            <FormField
              field={getCategoryField("status")}
              value={i?.status || "Visible"}
              prefix="category"
            />
            <label className="c-field span-full" htmlFor="category-description">
              <span>Description</span>
              <textarea
                id="category-description"
                name="description"
                rows={5}
                maxLength={2e3}
                value={d}
                placeholder="Help shoppers understand what belongs in this category."
                onChange={(e) => f(e.target.value)}
              />
              <small className="category-field-help">
                Shown on category landing pages where your storefront design
                supports category copy.
              </small>
            </label>
          </div>
        </section>
        <section className="category-editor-section">
          <div className="category-editor-section-head">
            <span>
              <Icon name="image" />
            </span>
            <div>
              <small>STOREFRONT MEDIA</small>
              <h3>Category images</h3>
              <p>
                Add a wide cover and a compact thumbnail for homepage sections,
                navigation and collection-style category cards.
              </p>
            </div>
          </div>
          <div className="category-media-grid">
            <FormField
              field={getCategoryField("coverImageId")}
              value={i?.coverImageId || ""}
              prefix="category"
              mediaFolder="Category images"
            />
            <FormField
              field={getCategoryField("thumbnailImageId")}
              value={i?.thumbnailImageId || ""}
              prefix="category"
              mediaFolder="Category images"
            />
          </div>
          <label
            className="c-field category-alt-field"
            htmlFor="category-image-alt"
          >
            <span>Image alt text</span>
            <input
              id="category-image-alt"
              name="imageAlt"
              type="text"
              maxLength={160}
              defaultValue={String(i?.imageAlt || "")}
              placeholder="Describe the category image for accessibility"
            />
            <small className="category-field-help">
              Use concise, meaningful text. Leave blank when the image is purely
              decorative.
            </small>
          </label>
          <div className="category-media-guidance">
            <span>
              <Icon name="info" />
            </span>
            <p>
              <strong>Recommended:</strong>
              {
                " cover 1600 × 640px, thumbnail 800 × 800px. PNG, JPEG, WebP or GIF. Images are stored in the Media Library."
              }
            </p>
          </div>
        </section>
        <section className="category-editor-section category-seo-section">
          <div className="category-editor-section-head">
            <span>
              <Icon name="search" />
            </span>
            <div>
              <small>SEARCH DISCOVERY</small>
              <h3>Category SEO</h3>
              <p>
                Control how this category is described to search engines without
                changing the shopper-facing category name.
              </p>
            </div>
          </div>
          <div className="c-form-grid category-seo-grid">
            <label className="c-field" htmlFor="category-seo-title">
              <span>
                {"Meta title "}
                <small className="category-char-count">{p.length}/60</small>
              </span>
              <input
                id="category-seo-title"
                name="seoTitle"
                type="text"
                maxLength={60}
                value={p}
                onChange={(e) => m(e.target.value)}
                placeholder="Search result title"
              />
              <small className="category-field-help">
                Recommended: up to 60 characters.
              </small>
            </label>
            <label className="c-field" htmlFor="category-seo-index">
              <span>Search visibility</span>
              <select id="category-seo-index" name="seoIndex" defaultValue={x}>
                <option value="Index">Index · allow search engines</option>
                <option value="Noindex">
                  Noindex · keep out of search results
                </option>
              </select>
              <small className="category-field-help">
                Use Noindex for internal or temporary browsing groups.
              </small>
            </label>
            <label
              className="c-field span-full"
              htmlFor="category-seo-description"
            >
              <span>
                {"Meta description "}
                <small className="category-char-count">{h.length}/160</small>
              </span>
              <textarea
                id="category-seo-description"
                name="seoDescription"
                rows={4}
                maxLength={160}
                value={h}
                onChange={(e) => g(e.target.value)}
                placeholder="A concise summary for search results"
              />
              <small className="category-field-help">
                Recommended: up to 160 characters.
              </small>
            </label>
            <label className="c-field span-full" htmlFor="category-slug">
              <span>URL slug</span>
              <div className="category-slug-control">
                <span>/categories/</span>
                <input
                  id="category-slug"
                  name="slug"
                  type="text"
                  maxLength={120}
                  value={_}
                  onChange={(e) => {
                    y.current = !!e.target.value.trim();
                    v(e.target.value);
                  }}
                  placeholder="auto-generated-from-name"
                />
              </div>
              <small className="category-field-help">
                Lowercase letters, numbers and hyphens. Leave blank to generate
                it from the category name.
              </small>
            </label>
          </div>
          <div
            className="category-search-preview"
            aria-label="Search result preview"
          >
            <small>SEARCH RESULT PREVIEW</small>
            <span>store.example/categories/{C}</span>
            <strong>{w}</strong>
            <p>{T}</p>
          </div>
        </section>
        <div className="category-editor-note">
          <Icon name="info" />
          <p>
            Top-level categories organize your main storefront navigation.
            Sub-categories stay one level deep so the catalog remains easy to
            browse.
          </p>
        </div>
        <p className="c-form-error" role="alert">
          {o}
        </p>
        <div className="c-form-footer category-editor-footer">
          <button type="submit" className="primary-button">
            Save category
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
