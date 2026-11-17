// @ts-nocheck
import { productFormDefaults } from "@/features/products/editor/data";

function toFormString(e, t = "") {
  return e == null ? t : String(e);
}

function toFormStringOrFallback(e, t) {
  return e == null || e === "" ? t : String(e);
}

function toStringArray(e) {
  return Array.isArray(e) ? e.filter((e) => typeof e == "string") : [];
}

function toAttributeSelections(e) {
  return Array.isArray(e)
    ? e.filter((e) => !!(e && typeof e == "object" && "attributeId" in e))
    : [];
}

export function buildProductFormValues(e) {
  const t = toFormString(e?.description);
  const n = toStringArray(e?.categories);
  const r = toFormString(e?.category);
  const i = Number(e?.comparePrice || 0) > 0 ? e?.comparePrice : e?.price;
  return {
    ...productFormDefaults,
    name: toFormString(e?.name),
    sku: toFormString(e?.sku),
    shortDescription: toFormString(e?.shortDescription, t.slice(0, 220)),
    description: t,
    descriptionHtml: toFormString(e?.descriptionHtml, t ? `<p>${t}</p>` : ""),
    mediaIds: toStringArray(e?.mediaIds),
    videoMediaId: toFormString(e?.videoMediaId),
    category: r,
    categories: n.length ? n : r ? [r] : [],
    brand: toFormString(e?.brand),
    productType: toFormString(e?.productType, "Physical"),
    vendor: toFormString(e?.vendor),
    collections: Array.isArray(e?.collections)
      ? toStringArray(e?.collections).join(", ")
      : toFormString(e?.collections),
    tags: Array.isArray(e?.tags)
      ? toStringArray(e?.tags).join(", ")
      : toFormString(e?.tags),
    productAttributes: toAttributeSelections(e?.productAttributes),
    relatedProductIds: toStringArray(e?.relatedProductIds),
    price: toFormStringOrFallback(e?.price, "0"),
    comparePrice: toFormStringOrFallback(i, "0"),
    cost: toFormStringOrFallback(e?.cost, "0"),
    purchasePrice: toFormStringOrFallback(e?.purchasePrice ?? e?.cost, "0"),
    additionalCost: toFormStringOrFallback(e?.additionalCost, "0"),
    wholesalePrice: toFormStringOrFallback(e?.wholesalePrice, "0"),
    minimumSellingPrice: toFormStringOrFallback(e?.minimumSellingPrice, "0"),
    discountPercentage: toFormStringOrFallback(e?.discountPercentage, "0"),
    discountAmount: toFormStringOrFallback(e?.discountAmount, "0"),
    stock: toFormStringOrFallback(e?.stock, "0"),
    reservedStock: toFormStringOrFallback(e?.reservedStock, "0"),
    threshold: toFormStringOrFallback(e?.threshold, "15"),
    reorderLevel: toFormStringOrFallback(e?.reorderLevel, "15"),
    unit: toFormString(e?.unit, "pcs"),
    barcode: toFormString(e?.barcode),
    trackInventory: e?.trackInventory == null || !!e.trackInventory,
    allowBackorder: e?.allowBackorder != null && !!e.allowBackorder,
    weight: toFormStringOrFallback(e?.weight, "0"),
    width: toFormStringOrFallback(e?.width, "0"),
    height: toFormStringOrFallback(e?.height, "0"),
    depth: toFormStringOrFallback(e?.depth, "0"),
    origin: toFormString(e?.origin),
    hsCode: toFormString(e?.hsCode),
    taxClass: toFormString(e?.taxClass, "Standard"),
    taxable: e?.taxable == null || !!e.taxable,
    domesticDeliveryCharge: toFormStringOrFallback(
      e?.domesticDeliveryCharge,
      "0",
    ),
    internationalDeliveryCharge: toFormStringOrFallback(
      e?.internationalDeliveryCharge,
      "0",
    ),
    deliveryTimeMode: toFormString(e?.deliveryTimeMode, "Use store default"),
    seoTitle: toFormString(e?.seoTitle),
    seoDescription: toFormString(e?.seoDescription),
    seoKeywords: toFormString(e?.seoKeywords),
    slug: toFormString(e?.slug),
    searchVisibility: toFormString(e?.searchVisibility, "Index"),
    catalogVisibility: toFormString(e?.catalogVisibility, "Everywhere"),
    availableForOrder: e?.availableForOrder == null || !!e.availableForOrder,
    showPrice: e?.showPrice == null || !!e.showPrice,
    status: toFormString(e?.status, "Draft"),
    featured: e?.featured != null && !!e.featured,
  };
}

export function productSectionForError(e) {
  return /variant|stock|inventory|barcode|reserved|reorder|unit/i.test(e)
    ? "inventory"
    : /price|cost|discount|margin|wholesale|minimum selling/i.test(e)
      ? "pricing"
      : /category|brand|product type|vendor|seller|collection|tag|attribute|related product/i.test(
            e,
          )
        ? "catalog"
        : /weight|width|height|depth|origin|HS code|shipping|delivery|tax/i.test(
              e,
            )
          ? "shipping"
          : /SEO|slug|search|visibility|keyword/i.test(e)
            ? "seo"
            : /image|video|media|upload/i.test(e)
              ? "media"
              : "information";
}
