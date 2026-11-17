// @ts-nocheck

export function formatCurrency(e, t = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: t,
    minimumFractionDigits: t,
  }).format(e);
}

export function formatNumber(e) {
  return new Intl.NumberFormat("en-US").format(e);
}

export function escapeHtml(e) {
  return String(e).replace(
    /[&<>"']/g,
    (e) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[e],
  );
}

export function assetUrl(e) {
  return `/assets/${e}`;
}

export function slugify(e) {
  return String(e || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
