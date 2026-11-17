// @ts-nocheck
import { listRecords } from "@/lib/store/core";

export function getCollectionProducts(e, t = listRecords("products")) {
  const n = String(e.value || "").trim();
  if (e.rule === "Manual selection") {
    const e = new Set(
      n
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean),
    );
    return t.filter((t) => e.has(String(t.sku || "")));
  }
  return e.rule === "Category"
    ? t.filter((e) => e.category === n)
    : e.rule === "Price below"
      ? t.filter((e) => Number(e.price) < Number(n || 0))
      : e.rule === "Tag"
        ? t.filter((e) =>
            String(e.tags || "")
              .split(",")
              .map((e) => e.trim().toLowerCase())
              .filter(Boolean)
              .includes(n.toLowerCase()),
          )
        : [];
}

export function getTaggedProducts(e, t = listRecords("products")) {
  const n = String(e.name || "").toLowerCase();
  return t.filter((e) =>
    String(e.tags || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .includes(n),
  );
}
