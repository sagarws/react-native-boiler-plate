// @ts-nocheck
import { modulesById } from "@/config/modules/registry";
import { shortDateFormatter } from "@/lib/intl-formatters";
import { listRecords } from "@/lib/store/core";

export function getProductStockStatus(e) {
  return String(e.status || "") === "Draft"
    ? "Draft"
    : Number(e.stock || 0) <= 0
      ? "Out of stock"
      : Number(e.stock || 0) <= Number(e.threshold ?? 15)
        ? "Low stock"
        : String(e.status || "Active");
}

export function formatProductUpdatedAt(e) {
  const t = e.updatedAt ? new Date(String(e.updatedAt)) : void 0;
  return t && !Number.isNaN(t.getTime()) ? shortDateFormatter.format(t) : "—";
}

export function getProductSortValue(e, t) {
  if (t === "sales") return Number(e.sold || 0);
  if (t === "revenue") return Number(e.sold || 0) * Number(e.price || 0);
  if (t === "inventory") return Number(e.stock || 0);
  if (t === "trend") return Number(e.trend || 0);
  if (t === "rating") return Number(e.rating || 0);
  if (t === "modified") return Date.parse(String(e.updatedAt || "")) || 0;
  if (t === "status") return getProductStockStatus(e);
  const n = e[t];
  return typeof n == "number" ? n : String(n || "");
}

export function getProductThumbnail(e) {
  const t = Array.isArray(e.mediaIds) ? e.mediaIds : [];
  const n = {
    tee: "t-shirt",
    mug: "coffee",
    bottle: "thermometer",
  };
  const r = String(e.image || "");
  return {
    mediaId: t.length ? String(t[0] || "") : void 0,
    icon: n[r] || r,
  };
}

export const productsModule = modulesById.products;

export function findProductById(e) {
  return [
    ...listRecords("products"),
    ...listRecords("products", {
      archived: true,
    }),
  ].find((t) => t.id === e);
}
