// @ts-nocheck

export function buildProductTrendLabels(e) {
  const t = Number(e.id);
  const n = Date.UTC(2026, 3, 30);
  return e.trend.map((r, i) => {
    const a = Math.round((t - 1) * (1 - i / (e.trend.length - 1)));
    return new Date(n - a * 864e5).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  });
}
