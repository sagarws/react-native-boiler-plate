// @ts-nocheck
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProductAssistantTip } from "@/features/products/editor/components/product-assistant-tip";
import { ProductCatalogSection } from "@/features/products/editor/components/product-catalog-section";
import { ProductEditorFooter } from "@/features/products/editor/components/product-editor-footer";
import { ProductEditorHeader } from "@/features/products/editor/components/product-editor-header";
import { ProductEditorNavigation } from "@/features/products/editor/components/product-editor-navigation";
import { ProductInformationSection } from "@/features/products/editor/components/product-information-section";
import { ProductInventorySection } from "@/features/products/editor/components/product-inventory-section";
import { ProductMediaSection } from "@/features/products/editor/components/product-media-workspace";
import { ProductPricingSection } from "@/features/products/editor/components/product-pricing-section";
import { ProductReadinessChecklist } from "@/features/products/editor/components/product-readiness-checklist";
import { ProductSeoSection } from "@/features/products/editor/components/product-seo-section";
import { ProductShippingSection } from "@/features/products/editor/components/product-shipping-section";
import { productEditorSections } from "@/features/products/editor/data";
import {
  buildProductFormValues,
  productSectionForError,
} from "@/features/products/editor/lib/product-form";
import {
  htmlToPlainText,
  sanitizeProductRichText,
  slugifyProductHandle,
  splitUniqueCommaList,
} from "@/features/products/editor/lib/rich-text";
import { showToast } from "@/lib/events";
import { revokeProductImageUrls } from "@/lib/media-storage";
import { buildHref, navigate } from "@/lib/navigation";
import { parseOptionGroups } from "@/lib/product-options";
import { findRecord, listRecords } from "@/lib/store/core";
import { saveProduct } from "@/lib/store/products";

export function ProductEditorPage({ productId }) {
  const t = useMemo(
    () => (productId ? findRecord("products", productId) : void 0),
    [productId],
  );
  const n = !!(productId && t);
  const r = !(!productId || t);
  const [i, a] = useState(() => buildProductFormValues(t));
  const o = useMemo(() => parseOptionGroups(t || {}), [t]);
  const [s, c] = useState(() => structuredClone(o));
  const [u, d] = useState(() => JSON.stringify(o));
  const [f, p] = useState(false);
  const [m, h] = useState(() =>
    productId
      ? listRecords("variants").filter((t) => t.productId === productId)
      : [],
  );
  const [g, _] = useState("information");
  const [v, y] = useState("");
  const [b, x] = useState(false);
  const S = useRef(null);
  useEffect(() => () => revokeProductImageUrls(), []);
  useEffect(() => {
    if (i.productType === "Digital" && g === "shipping") {
      _("seo");
    }
  }, [i.productType, g]);
  const C = useCallback(
    (e, t) =>
      a((n) => ({
        ...n,
        [e]: t,
      })),
    [],
  );
  const w = i.productType !== "Digital";
  const T = i.mediaIds.length;
  const E = Number(i.price || 0);
  const D = Number(i.minimumSellingPrice || 0);
  const O = useMemo(
    () => ({
      information: {
        complete: !!(
          i.name.trim() &&
          i.sku.trim() &&
          i.shortDescription.trim()
        ),
        label: "Required",
      },
      media: {
        complete: T > 0,
        label: "Cover required",
      },
      catalog: {
        complete: !!i.category,
        label: "Primary category",
      },
      pricing: {
        complete: E > 0 && (!D || E >= D),
        label: "Required",
      },
      inventory: {
        complete: !f && Number(i.reservedStock || 0) <= Number(i.stock || 0),
        label: "Review",
      },
      shipping: {
        complete: !w || Number(i.weight || 0) > 0,
        label: w ? "Optional" : "Ready",
        disabled: !w,
      },
      seo: {
        complete: !!(i.seoDescription.trim() && i.status),
        label: "Finish & publish",
      },
    }),
    [i, T, E, D, f, w],
  );
  const k = (t) => {
    t.preventDefault();
    y("");
    try {
      if (b) throw Error("Wait for media uploads to finish.");
      if (f)
        throw Error(
          "Select Generate variants to update the combinations after changing options.",
        );
      const n = t.nativeEvent.submitter?.value || "save";
      const r = {
        ...i,
      };
      [
        "price",
        "purchasePrice",
        "additionalCost",
        "wholesalePrice",
        "minimumSellingPrice",
        "stock",
        "reservedStock",
        "threshold",
        "reorderLevel",
        "weight",
        "width",
        "height",
        "depth",
        "domesticDeliveryCharge",
        "internationalDeliveryCharge",
      ].forEach((e) => {
        r[e] = Number(i[e] || 0);
      });
      const a = Number(i.comparePrice || 0);
      const o = Math.max(0, a - E);
      if (
        ((r.comparePrice = a),
        (r.discountAmount = o),
        (r.discountPercentage = a > 0 && E < a ? (o / a) * 100 : 0),
        (r.cost = Number(i.purchasePrice || 0) + Number(i.additionalCost || 0)),
        (r.mediaIds = i.mediaIds),
        (r.videoMediaId = i.videoMediaId),
        (r.categories = [...i.categories]),
        (r.productAttributes = i.productAttributes),
        (r.relatedProductIds = i.relatedProductIds),
        (r.optionGroups = s),
        (r.descriptionHtml = sanitizeProductRichText(i.descriptionHtml || "")),
        (r.description = htmlToPlainText(String(r.descriptionHtml || ""))),
        (r.shortDescription = i.shortDescription.trim()),
        (r.tags = splitUniqueCommaList(i.tags).join(", ")),
        (r.collections = splitUniqueCommaList(i.collections).join(", ")),
        n === "draft" && (r.status = "Draft"),
        (r.slug = slugifyProductHandle(i.slug || i.name)),
        !i.category)
      )
        throw Error("Choose a primary category.");
      if (
        (r.categories.includes(i.category) || r.categories.unshift(i.category),
        Number(i.reservedStock || 0) > Number(i.stock || 0))
      )
        throw Error("Reserved stock cannot exceed current stock.");
      if (a > 0 && E > a)
        throw Error("Sale price cannot be higher than the regular price.");
      if (D > 0 && E < D)
        throw Error("Selling price cannot be below the minimum selling price.");
      if (productId && i.relatedProductIds.includes(productId))
        throw Error("A product cannot be related to itself.");
      const c = saveProduct(r, m, productId || void 0);
      showToast(`${c.name} saved${c.status === "Draft" ? " as a draft" : ""}.`);
      navigate(
        n.startsWith("ai-")
          ? `/commerce/ai-studio?productId=${encodeURIComponent(c.id)}&task=${n === "ai-seo" ? "SEO" : "Product%20copy"}`
          : `/commerce/products?q=${encodeURIComponent(c.sku)}`,
      );
    } catch (e) {
      const t = e instanceof Error ? e.message : "Product could not be saved.";
      _(productSectionForError(t));
      y(t);
      requestAnimationFrame(() => S.current?.focus());
    }
  };
  if (r)
    return (
      <section className="glass-card c-empty">
        <h1>Product not found</h1>
        <p>This product may have been archived.</p>
        <Link
          className="secondary-button"
          href={buildHref("/commerce/products")}
        >
          Back to products
        </Link>
      </section>
    );
  const A = productEditorSections.find((e) => e.id === g)?.label || "Information";
  return (
    <form
      id="product-editor"
      className="product-editor c-form"
      onSubmit={k}
      data-uploading={b ? "true" : void 0}
    >
      <ProductEditorHeader editing={n} uploading={b} />
      <p
        className="c-form-error product-save-error"
        role="alert"
        tabIndex={-1}
        ref={S}
      >
        {v}
      </p>
      <div className="product-editor-layout">
        <div className="product-editor-main">
          <ProductInformationSection
            values={i}
            setField={C}
            hidden={g !== "information"}
          />
          <ProductMediaSection
            values={i}
            setMediaIds={(e) => C("mediaIds", e)}
            setVideoId={(e) => C("videoMediaId", e)}
            onUploadingChange={x}
            onError={y}
            hidden={g !== "media"}
          />
          <ProductCatalogSection
            values={i}
            setField={C}
            productId={productId}
            hidden={g !== "catalog"}
          />
          <ProductPricingSection
            values={i}
            setField={C}
            hidden={g !== "pricing"}
          />
          <ProductInventorySection
            values={i}
            setField={C}
            groups={s}
            variants={m}
            generatedOptions={u}
            onGroupsChange={(e, t) => {
              c(e);
              p(t);
            }}
            onGeneratedOptionsChange={d}
            onVariantsChange={h}
            hidden={g !== "inventory"}
          />
          <ProductShippingSection
            values={i}
            setField={C}
            hidden={g !== "shipping"}
          />
          <ProductSeoSection values={i} setField={C} hidden={g !== "seo"} />
        </div>
        <aside className="product-editor-aside">
          <ProductEditorNavigation active={g} onChange={_} readiness={O} />
          <ProductReadinessChecklist values={i} optionsDirty={f} />
          <ProductAssistantTip uploading={b} />
        </aside>
      </div>
      <ProductEditorFooter editing={n} uploading={b} currentSection={A} />
    </form>
  );
}
