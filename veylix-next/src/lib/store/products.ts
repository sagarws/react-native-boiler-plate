// @ts-nocheck
import { modulesById } from "@/config/modules/registry";
import { normalizeCsvHeader, parseCsv } from "@/lib/csv";
import { slugify } from "@/lib/format";
import {
  formatOptionGroups,
  validateOptionGroups,
} from "@/lib/product-options";
import {
  appendAuditEntry,
  cloneData,
  createId,
  findRecord,
  getCollection,
  listRecords,
  nowIso,
  readCommerceState,
  writeCommerceState,
} from "@/lib/store/core";
import { setProductStock } from "@/lib/store/inventory";
import { validateRecord } from "@/lib/store/records";

export function saveCategory(e, t) {
  const n = readCommerceState();
  const r = getCollection(n, "categories");
  const i = r.find((e) => e.id === t);
  if (t && !i) throw Error("This category no longer exists.");
  const a = String(e.name ?? i?.name ?? "").trim();
  const o = String(e.parent ?? i?.parent ?? "None").trim() || "None";
  if (!a) throw Error("Name is required.");
  const s = r.filter(
    (e) => e.id !== t && !e._archived && (!e.parent || e.parent === "None"),
  );
  if (o !== "None" && !s.some((e) => e.name === o))
    throw Error("Choose an existing top-level parent category.");
  if (o === a) throw Error("A category cannot be its own parent.");
  if (
    r.some(
      (e) =>
        e.id !== t &&
        !e._archived &&
        String(e.name).toLowerCase() === a.toLowerCase() &&
        String(e.parent || "None").toLowerCase() === o.toLowerCase(),
    )
  )
    throw Error(
      "A category with this name already exists under the selected parent.",
    );
  if (
    i &&
    (!i.parent || i.parent === "None") &&
    o !== "None" &&
    r.some((e) => !e._archived && e.parent === i.name)
  )
    throw Error(
      "Move or archive this category’s sub-categories before making it a sub-category.",
    );
  const c =
    slugify(
      Object.prototype.hasOwnProperty.call(e, "slug")
        ? String(e.slug || "").trim()
        : String(i?.slug || "").trim(),
    ) ||
    slugify(a) ||
    `category-${r.length + 1}`;
  if (
    new Set(
      r
        .filter((e) => e.id !== t && !e._archived)
        .map((e) => String(e.slug || "").toLowerCase()),
    ).has(c.toLowerCase())
  )
    throw Error("URL slug is already in use.");
  const l = /^[\w-]{1,100}$/;
  for (const t of ["coverImageId", "thumbnailImageId"]) {
    const n = String(e[t] ?? i?.[t] ?? "").trim();
    if (n && !l.test(n)) throw Error("Choose a valid category image.");
  }
  const u = String(e.seoTitle ?? i?.seoTitle ?? "").trim();
  const d = String(e.seoDescription ?? i?.seoDescription ?? "").trim();
  const f = String(e.imageAlt ?? i?.imageAlt ?? "").trim();
  if (u.length > 60) throw Error("SEO title must be 60 characters or fewer.");
  if (d.length > 160)
    throw Error("SEO description must be 160 characters or fewer.");
  if (f.length > 160)
    throw Error("Image alt text must be 160 characters or fewer.");
  const p = {
    ...i,
    ...e,
    id: t || createId(),
    name: a,
    parent: o,
    slug: c,
    seoTitle: u,
    seoDescription: d,
    imageAlt: f,
    seoIndex: e.seoIndex ?? i?.seoIndex ?? "Index",
    status: e.status ?? i?.status ?? "Visible",
    featured: e.featured ?? i?.featured ?? false,
    productIds: Array.isArray(e.productIds)
      ? e.productIds
      : Array.isArray(i?.productIds)
        ? i.productIds
        : [],
    addedAt: i?.addedAt || e.addedAt || nowIso().slice(0, 10),
    updatedAt: nowIso(),
  };
  validateRecord("categories", p, t);
  let m = i ? r.map((e) => (e.id === t ? p : e)) : [p, ...r];
  n.collections ||= {};
  if (i && i.name !== p.name) {
    if (!(i.parent && i.parent !== "None")) {
      m = m.map((e) =>
        e.id !== p.id && e.parent === i.name
          ? {
              ...e,
              parent: p.name,
              updatedAt: nowIso(),
            }
          : e,
      );
    }
    n.collections.products = getCollection(n, "products").map((e) => {
      const t = Array.isArray(e.categories) && e.categories.includes(i.name);
      const n = t
        ? e.categories.map((e) => (e === i.name ? p.name : e))
        : e.categories;
      return e.category === i.name || t
        ? {
            ...e,
            category: e.category === i.name ? p.name : e.category,
            categories: n,
            updatedAt: nowIso(),
          }
        : e;
    });
  }
  n.collections.categories = m;
  appendAuditEntry(
    n,
    i ? "Updated category" : "Created category",
    "categories",
    p,
  );
  writeCommerceState(n);
  return p;
}

export function saveProduct(e, t, n) {
  e = Object.fromEntries(
    Object.entries(e).map(([e, t]) => [e, typeof t == "string" ? t.trim() : t]),
  );
  const r = readCommerceState();
  const i = getCollection(r, "products");
  const a = getCollection(r, "variants");
  const o = i.find((e) => e.id === n && !e._archived);
  if (n && !o)
    throw Error("This product no longer exists. Return to the product list.");
  const s = validateOptionGroups(e.optionGroups || []);
  if (!Array.isArray(t) || t.length > 150)
    throw Error(
      "Keep no more than 150 variant rows, including retained variants.",
    );
  const c = n || createId();
  const l = new Set();
  const u = new Set();
  const d = t.map((e) => {
    const t =
      e.id && a.find((t) => t.id === e.id && t.productId === c && !t._archived);
    if (e.id && (!t || u.has(e.id)))
      throw Error("A variant is missing or duplicated. Reload the product.");
    if (e.id) {
      u.add(e.id);
    }
    const n = String(e.sku || "").trim();
    const r = String(e.name || "").trim();
    if (!n || !r || n.length > 100 || r.length > 300)
      throw Error("Each variant needs a name and SKU (up to 100 characters).");
    if (
      l.has(n.toLowerCase()) ||
      a.some(
        (e) => e.productId !== c && e.sku?.toLowerCase() === n.toLowerCase(),
      )
    )
      throw Error(`Variant SKU ${n} is already in use.`);
    if (
      (l.add(n.toLowerCase()),
      !Number.isFinite(Number(e.price)) ||
        Number(e.price) < 0 ||
        !Number.isInteger(Number(e.stock)) ||
        Number(e.stock) < 0)
    )
      throw Error(`Enter a valid price and whole-number stock for ${r}.`);
    if (!["Active", "Disabled"].includes(e.status))
      throw Error("Choose a valid variant status.");
    return {
      ...t,
      id: t?.id || createId(),
      productId: c,
      name: r,
      sku: n,
      price: Number(e.price),
      stock: Number(e.stock),
      status: e.status,
      updatedAt: nowIso(),
    };
  });
  if (a.some((e) => e.productId === c && !e._archived && !u.has(e.id)))
    throw Error(
      "Keep existing variant rows; disable combinations you no longer sell.",
    );
  let f = {
    ...o,
    ...e,
    id: c,
    optionGroups: s,
    options: formatOptionGroups(s),
    updatedAt: nowIso(),
  };
  if (
    (o && Number(f.stock) !== Number(o.stock)
      ? (f = setProductStock(f, Number(f.stock), r))
      : !o &&
        !f.locationStock &&
        (f = setProductStock(f, Number(f.stock || 0), r)),
    validateRecord("products", f, n),
    d.reduce((e, t) => e + (t.status === "Active" ? t.stock : 0), 0) >
      Number(f.stock))
  )
    throw Error(
      "Variant quantities exceed available product stock. Increase product stock or reduce variant quantities.",
    );
  for (const e of [
    "barcode",
    "vendor",
    "tags",
    "collections",
    "origin",
    "hsCode",
    "seoKeywords",
  ])
    if (String(f[e] || "").length > 1e3) throw Error(`${e} is too long.`);
  if (String(f.shortDescription || "").length > 260)
    throw Error("Short description must be 260 characters or fewer.");
  if (String(f.descriptionHtml || "").length > 5e4)
    throw Error("Rich product description is too long.");
  if (!["Physical", "Digital"].includes(f.productType || "Physical"))
    throw Error("Choose a valid product type.");
  if (
    ![
      "pcs",
      "kg",
      "g",
      "set",
      "pair",
      "box",
      "pack",
      "liter",
      "ml",
      "meter",
      "cm",
    ].includes(f.unit || "pcs")
  )
    throw Error("Choose a valid selling unit.");
  if (
    !["Standard", "Reduced", "Zero-rated", "Exempt"].includes(
      f.taxClass || "Standard",
    )
  )
    throw Error("Choose a valid tax class.");
  if (
    ![
      "Use store default",
      "1–2 business days",
      "3–5 business days",
      "5–7 business days",
      "Custom quote",
    ].includes(f.deliveryTimeMode || "Use store default")
  )
    throw Error("Choose a valid delivery time.");
  if (!["Index", "Noindex"].includes(f.searchVisibility || "Index"))
    throw Error("Choose a valid search visibility setting.");
  if (
    !["Everywhere", "Search only", "Catalog only", "Hidden"].includes(
      f.catalogVisibility || "Everywhere",
    )
  )
    throw Error("Choose a valid catalog visibility setting.");
  for (const e of [
    "purchasePrice",
    "additionalCost",
    "wholesalePrice",
    "minimumSellingPrice",
    "reservedStock",
    "reorderLevel",
    "width",
    "height",
    "depth",
    "domesticDeliveryCharge",
    "internationalDeliveryCharge",
  ])
    if (!Number.isFinite(Number(f[e] || 0)) || Number(f[e] || 0) < 0)
      throw Error(
        `Enter a valid ${e.replace(/([A-Z])/g, " $1").toLowerCase()}.`,
      );
  if (Number(f.reservedStock || 0) > Number(f.stock || 0))
    throw Error("Reserved stock cannot exceed current stock.");
  if (
    Number(f.minimumSellingPrice || 0) > 0 &&
    Number(f.price || 0) < Number(f.minimumSellingPrice || 0)
  )
    throw Error("Selling price cannot be below the minimum selling price.");
  if (f.videoMediaId && !/^[\w-]{1,100}$/.test(String(f.videoMediaId)))
    throw Error("Choose a valid product video.");
  if (
    !Array.isArray(f.categories) ||
    !f.categories.length ||
    !f.categories.includes(f.category)
  )
    throw Error(
      "Choose at least one category and keep the primary category selected.",
    );
  const p = new Set(listRecords("categories").map((e) => e.name));
  if (f.categories.length > 12 || f.categories.some((e) => !p.has(e)))
    throw Error("Choose valid product categories.");
  if (!Array.isArray(f.productAttributes) || f.productAttributes.length > 20)
    throw Error("Choose up to 20 product attributes.");
  const m = new Set(listRecords("attributes").map((e) => e.id));
  if (
    f.productAttributes.some(
      (e) =>
        !e ||
        !m.has(e.attributeId) ||
        !Array.isArray(e.values) ||
        e.values.length > 50,
    )
  )
    throw Error("Choose valid product attribute values.");
  if (
    !Array.isArray(f.relatedProductIds) ||
    f.relatedProductIds.length > 20 ||
    f.relatedProductIds.some(
      (e) => e === c || !i.some((t) => t.id === e && !t._archived),
    )
  )
    throw Error("Choose valid related products.");
  r.collections ||= {};
  r.collections.products = o ? i.map((e) => (e.id === c ? f : e)) : [f, ...i];
  r.collections.variants = [
    ...a.filter((e) => e.productId !== c || e._archived),
    ...d,
  ];
  if (o && Number(f.stock) !== Number(o.stock)) {
    r.collections.adjustments = [
      {
        id: createId(),
        productId: c,
        warehouseId: "",
        delta: Number(f.stock) - Number(o.stock),
        before: Number(o.stock),
        after: Number(f.stock),
        reason: "Product editor stock update",
        date: nowIso(),
      },
      ...getCollection(r, "adjustments"),
    ];
  }
  appendAuditEntry(
    r,
    o ? "Updated product and variants" : "Created product and variants",
    "products",
    f,
  );
  writeCommerceState(r);
  return f;
}

function makeUniqueCode(e, t, n = "-") {
  const r = String(e || "").trim() || "COPY";
  let i = r;
  let a = 2;
  for (; t.has(i.toLowerCase());) i = `${r}${n}${a++}`;
  t.add(i.toLowerCase());
  return i;
}

export function duplicateProduct(e) {
  const t = readCommerceState();
  const n = getCollection(t, "products");
  const r = getCollection(t, "variants");
  const i = n.find((t) => t.id === e && !t._archived);
  if (!i) throw Error("This product is no longer available.");
  const a = new Set(n.map((e) => String(e.sku || "").toLowerCase()));
  const o = new Set(n.map((e) => String(e.slug || "").toLowerCase()));
  const s = createId();
  const c = makeUniqueCode(`${i.sku || "VX"}-COPY`, a);
  const l = makeUniqueCode(
    `${i.slug || i.name.toLowerCase().replace(/\s+/g, "-")}-copy`,
    o,
  );
  const u = {
    ...cloneData(i),
    id: s,
    name: `${i.name} Copy`,
    sku: c,
    slug: l,
    status: "Draft",
    sold: 0,
    rating: 0,
    trend: 0,
    updatedAt: nowIso(),
    _archived: false,
  };
  const d = new Set(r.map((e) => String(e.sku || "").toLowerCase()));
  const f = r
    .filter((t) => t.productId === e && !t._archived)
    .map((e) => ({
      ...cloneData(e),
      id: createId(),
      productId: s,
      sku: makeUniqueCode(`${e.sku || c}-COPY`, d),
      status: e.status,
      updatedAt: nowIso(),
      _archived: false,
    }));
  t.collections ||= {};
  t.collections.products = [u, ...n];
  t.collections.variants = [...r, ...f];
  appendAuditEntry(t, "Duplicated product", "products", u);
  writeCommerceState(t);
  return u;
}

export function importProductsFromCsv(e) {
  const t = parseCsv(e);
  if (t.length < 2)
    throw Error("Add a header row and at least one product row.");
  if (t.length > 501) throw Error("Import up to 500 products at a time.");
  const n = {
    name: ["name", "product", "productname"],
    sku: ["sku"],
    category: ["category"],
    brand: ["brand"],
    price: ["price", "sellingprice"],
    comparePrice: ["compareprice", "compareatprice"],
    cost: ["cost", "costperitem"],
    stock: ["stock", "inventory", "availablestock"],
    threshold: ["threshold", "lowstockthreshold"],
    status: ["status"],
    description: ["description"],
    slug: ["slug", "urlslug"],
    weight: ["weight", "weightkg"],
  };
  const r = t[0].map(normalizeCsvHeader);
  const i = (e) => r.findIndex((t) => n[e].includes(t));
  const a = Object.fromEntries(Object.keys(n).map((e) => [e, i(e)]));
  if (a.name < 0 || a.sku < 0)
    throw Error("CSV must include Name and SKU columns.");
  const o = readCommerceState();
  const s = getCollection(o, "products");
  const c = new Set();
  const l = new Set(s.map((e) => String(e.slug || "").toLowerCase()));
  const u = new Set(s.map((e) => String(e.sku || "").toLowerCase()));
  const d = (e, t, n = false, r = 0) => {
    if (String(e ?? "").trim() === "") return r;
    const i = Number(e);
    if (!Number.isFinite(i) || i < 0 || (n && !Number.isInteger(i)))
      throw Error(`${t} must be a valid ${n ? "whole number" : "number"}.`);
    return i;
  };
  const f = t.slice(1).map((e, t) => {
    const n = (t) => (a[t] < 0 ? "" : String(e[a[t]] ?? "").trim());
    const r = n("name");
    const i = n("sku");
    if (!r || !i) throw Error(`Row ${t + 2}: Name and SKU are required.`);
    const o = i.toLowerCase();
    if (u.has(o) || c.has(o))
      throw Error(`Row ${t + 2}: SKU ${i} is already in use.`);
    c.add(o);
    const s = n("status") || "Draft";
    if (!["Active", "Draft"].includes(s))
      throw Error(`Row ${t + 2}: Status must be Active or Draft.`);
    const f = makeUniqueCode(
      n("slug") ||
        r
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") ||
        `product-${t + 1}`,
      l,
    );
    const p = {
      id: createId(),
      name: r,
      sku: i,
      category: n("category"),
      brand: n("brand"),
      price: d(n("price"), `Row ${t + 2} price`),
      comparePrice: d(n("comparePrice"), `Row ${t + 2} compare-at price`),
      cost: d(n("cost"), `Row ${t + 2} cost`),
      stock: d(n("stock"), `Row ${t + 2} stock`, true),
      threshold: d(
        n("threshold"),
        `Row ${t + 2} low-stock threshold`,
        true,
        15,
      ),
      status: s,
      description: n("description"),
      options: "",
      seoTitle: "",
      seoDescription: "",
      slug: f,
      weight: d(n("weight"), `Row ${t + 2} weight`),
      sold: 0,
      rating: 0,
      trend: 0,
      image: "package",
      updatedAt: nowIso(),
    };
    validateRecord("products", p);
    return p;
  });
  o.collections ||= {};
  o.collections.products = [...f, ...s];
  f.forEach((e) => appendAuditEntry(o, "Imported product", "products", e));
  writeCommerceState(o);
  return f.length;
}

export function getProductActivity(e) {
  const t = findRecord("products", e);
  const n = listRecords("products", {
    archived: true,
  }).find((t) => t.id === e);
  const r = t || n;
  if (!r) return [];
  const i = modulesById.products?.title || "products";
  return listRecords("audit")
    .filter(
      (t) => t.recordId === e || (t.resource === i && t.record === r.name),
    )
    .slice(0, 50);
}
