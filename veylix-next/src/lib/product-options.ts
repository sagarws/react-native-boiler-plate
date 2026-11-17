// @ts-nocheck

const optionColorSwatches = {
  sand: "#d6c3a0",
  olive: "#78835e",
  ink: "#303a47",
  black: "#252525",
  white: "#ffffff",
  red: "#d95858",
  blue: "#588dc8",
  green: "#54a477",
};

export function colorForOptionValue(e) {
  return optionColorSwatches[String(e).toLowerCase()] || "#c8b68e";
}

export function parseOptionGroups(e = {}) {
  return Array.isArray(e.optionGroups)
    ? structuredClone(e.optionGroups)
    : (e.options || "")
        .split(";")
        .filter((e) => e.trim())
        .map((e) => {
          const [t, ...n] = e.split(":");
          const r = /colou?r/i.test(t) ? "Color" : "Text";
          return {
            name: t.trim(),
            type: r,
            values: n
              .join(":")
              .split(",")
              .map((e) => e.trim())
              .filter(Boolean)
              .map((e) => ({
                label: e,
                ...(r === "Color"
                  ? {
                      color: colorForOptionValue(e),
                    }
                  : {}),
              })),
          };
        });
}

export function validateOptionGroups(e) {
  if (!Array.isArray(e) || e.length > 3)
    throw Error("Use up to 3 option groups per product.");
  const t = new Set();
  return e.map((e) => {
    const n = String(e.name || "").trim();
    if (!n || n.length > 60 || /[;:]/.test(n) || t.has(n.toLowerCase()))
      throw Error(
        "Give each option a different name (up to 60 characters, without : or ;).",
      );
    if ((t.add(n.toLowerCase()), !["Color", "Text"].includes(e.type)))
      throw Error("Choose Color or Text for the option type.");
    if (!Array.isArray(e.values) || !e.values.length || e.values.length > 30)
      throw Error(`Add 1–30 values to ${n}.`);
    const r = new Set();
    const i = e.values.map((t) => {
      const i = String(t.label || "").trim();
      if (!i || i.length > 60 || /[,;:/]/.test(i) || r.has(i.toLowerCase()))
        throw Error(
          `Use unique values for ${n}, without commas, colons, slashes or semicolons.`,
        );
      if (
        (r.add(i.toLowerCase()),
        e.type === "Color" && !/^#[a-f\d]{6}$/i.test(t.color))
      )
        throw Error(`Choose a valid color for ${i}.`);
      return {
        label: i,
        ...(e.type === "Color"
          ? {
              color: t.color.toLowerCase(),
            }
          : {}),
      };
    });
    return {
      name: n,
      type: e.type,
      values: i,
    };
  });
}

export function formatOptionGroups(e) {
  return e
    .map((e) => `${e.name}: ${e.values.map((e) => e.label).join(", ")}`)
    .join("; ");
}

export function buildVariantsFromOptions(e, t, n, r = []) {
  const i = validateOptionGroups(e);
  if (!i.length) return [];
  if (i.reduce((e, t) => e * t.values.length, 1) > 100)
    throw Error(
      "These options create more than 100 variants. Reduce the number of values.",
    );
  const a = i.reduce(
    (e, t) => e.flatMap((e) => t.values.map((t) => [...e, t.label])),
    [[]],
  );
  const o = new Set(r.map((e) => e.sku?.toLowerCase()));
  return a.map((e, i) => {
    const a = e.join(" / ");
    const s = r.find((e) => e.name.toLowerCase() === a.toLowerCase());
    if (s)
      return {
        ...s,
      };
    const c =
      e
        .join("-")
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, "")
        .replace(/^-+|-+$/g, "") || `V${i + 1}`;
    const l = `${t.trim() || "SKU"}-${c}`;
    let u = l;
    let d = 1;
    for (; o.has(u.toLowerCase());) u = `${l}-${++d}`;
    o.add(u.toLowerCase());
    return {
      name: a,
      sku: u,
      price: Number(n) || 0,
      stock: 0,
      status: "Active",
    };
  });
}
