// @ts-nocheck

function getCategoryProducts(e, t, n) {
  if (e._archived) return [];
  if (!e.parent || e.parent === "None") {
    const r = new Set(
      n
        .filter((t) => !t._archived && t.parent === e.name)
        .map((e) => String(e.name || "")),
    );
    return t.filter(
      (t) => t.category === e.name || r.has(String(t.category || "")),
    );
  }
  const r = new Set(Array.isArray(e.productIds) ? e.productIds.map(String) : []);
  return t.filter((t) => t.category === e.name || r.has(t.id));
}

export function getCategoryMetrics(e, t, n) {
  const r = getCategoryProducts(e, t, n);
  const i = r.reduce((e, t) => e + Number(t.sold || 0) * Number(t.price || 0), 0);
  const a = r.length
    ? r.reduce((e, t) => e + Number(t.trend || 0), 0) / r.length
    : 0;
  const o = t.reduce((e, t) => e + Number(t.sold || 0) * Number(t.price || 0), 0);
  return {
    products: r.length,
    revenue: i,
    trend: a,
    share: o ? (i / o) * 100 : 0,
  };
}

export function getCategoryIconName(e) {
  const t = e.toLowerCase();
  return /cloth|tee|shirt/.test(t)
    ? "t-shirt"
    : /bag|pack|tote|pouch/.test(t)
      ? "backpack"
      : /home|table|drink|textile|organ/.test(t)
        ? "house"
        : /electron|computer|desk tech|audio/.test(t)
          ? "mouse"
          : /station|note|writing/.test(t)
            ? "notebook"
            : "tag";
}
