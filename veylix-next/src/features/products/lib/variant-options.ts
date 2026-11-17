// @ts-nocheck

function parseProductOptionGroups(e) {
  const t = e.optionGroups;
  return (
    Array.isArray(t) && t.length
      ? t.map((e) => {
          const t = e;
          return {
            name: String(t.name || t.label || "").trim(),
            values: Array.isArray(t.values) ? t.values.map(String) : [],
          };
        })
      : String(e.options || "")
          .split(";")
          .map((e) => {
            const [t, ...n] = e.split(":");
            return {
              name: String(t || "").trim(),
              values: n
                .join(":")
                .split(",")
                .map((e) => e.trim())
                .filter(Boolean),
            };
          })
  ).filter((e) => e.name && e.values.length);
}

export function summarizeProductOptions(e) {
  const t = new Map();
  e.forEach((e) =>
    parseProductOptionGroups(e).forEach((n) => {
      const r = n.name.toLowerCase();
      const i = t.get(r) || {
        name: n.name,
        products: new Set(),
        values: new Set(),
      };
      i.products.add(e.id);
      n.values.forEach((e) => i.values.add(e));
      t.set(r, i);
    }),
  );
  return [...t.values()].sort(
    (e, t) => t.products.size - e.products.size || e.name.localeCompare(t.name),
  );
}
