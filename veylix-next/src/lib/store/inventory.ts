// @ts-nocheck
import {
  appendAuditEntry,
  createId,
  findRecord,
  getCollection,
  getRecordLabel,
  nowIso,
  readCommerceState,
  writeCommerceState,
} from "@/lib/store/core";

export function getActiveWarehouseIds(e = readCommerceState()) {
  const t = getCollection(e, "warehouses").filter(
    (e) => !e._archived && e.status !== "Paused",
  );
  return (
    t.length ? t : getCollection(e, "warehouses").filter((e) => !e._archived)
  ).map((e) => e.id);
}

export function allocateLocationStock(e, t = readCommerceState()) {
  const n = getActiveWarehouseIds(t);
  const r = Math.max(0, Number(e?.stock || 0));
  if (!n.length) return {};
  const i =
    e?.locationStock && typeof e.locationStock == "object"
      ? e.locationStock
      : {};
  const a = Object.fromEntries(
    n.map((e) => [e, Math.max(0, Math.trunc(Number(i[e] || 0)))]),
  );
  const o = Object.values(a).reduce((e, t) => e + t, 0);
  if (o === r) return a;
  if (o > 0) {
    let e = r;
    n.forEach((t, i) => {
      const s = i === n.length - 1 ? e : Math.min(e, Math.round((r * a[t]) / o));
      a[t] = s;
      e -= s;
    });
    return a;
  }
  const s =
    n.length === 1
      ? [1]
      : n.length === 2
        ? [0.65, 0.35]
        : [0.55, 0.3, 0.15, ...Array(Math.max(0, n.length - 3)).fill(0)];
  let c = r;
  n.forEach((e, t) => {
    const i = t === n.length - 1 ? c : Math.min(c, Math.round(r * (s[t] || 0)));
    a[e] = i;
    c -= i;
  });
  return a;
}

export function getProductLocationStock(e) {
  const t = typeof e == "string" ? findRecord("products", e) : e;
  return t ? allocateLocationStock(t) : {};
}

export function setProductStock(e, t, n = readCommerceState()) {
  const r = allocateLocationStock(e, n);
  const i = Object.keys(r);
  const a = Object.values(r).reduce((e, t) => e + t, 0);
  if (!i.length)
    return {
      ...e,
      stock: t,
    };
  if (a === t)
    return {
      ...e,
      stock: t,
      locationStock: r,
    };
  if (a <= 0) {
    r[i[0]] = t;
    return {
      ...e,
      stock: t,
      locationStock: r,
    };
  }
  let o = t;
  i.forEach((e, n) => {
    const s = n === i.length - 1 ? o : Math.min(o, Math.round((t * r[e]) / a));
    r[e] = s;
    o -= s;
  });
  return {
    ...e,
    stock: t,
    locationStock: r,
  };
}

export function adjustProductStock(e, t, n, r) {
  const i = readCommerceState();
  const a = getCollection(i, "products");
  const o = a.find((t) => t.id === e);
  const s = getCollection(i, "warehouses").filter(
    (e) => !e._archived && e.status !== "Paused",
  );
  const c = r || s[0]?.id;
  if (
    !o ||
    !Number.isInteger(t) ||
    t === 0 ||
    Number(o.stock) + t < 0 ||
    !String(n || "").trim()
  )
    throw Error(
      "Enter a non-zero whole number and a reason. Stock cannot become negative.",
    );
  if (!c || !s.some((e) => e.id === c))
    throw Error("Choose an active inventory location.");
  const l = allocateLocationStock(o, i);
  const u = Number(l[c] || 0);
  if (u + t < 0)
    throw Error(
      `${getRecordLabel("warehouses", c)} only has ${u} units available for this adjustment.`,
    );
  const d = Number(o.stock) + t;
  if (
    getCollection(i, "variants")
      .filter((t) => t.productId === e && !t._archived && t.status === "Active")
      .reduce((e, t) => e + Number(t.stock), 0) > d
  )
    throw Error(
      "This adjustment would put stock below active variant allocations. Update variant quantities in the product editor first.",
    );
  l[c] = u + t;
  const f = {
    ...o,
    stock: d,
    locationStock: l,
    updatedAt: nowIso(),
  };
  i.collections ||= {};
  i.collections.products = a.map((t) => (t.id === e ? f : t));
  i.collections.adjustments = [
    {
      id: createId(),
      productId: e,
      warehouseId: c,
      delta: t,
      before: Number(o.stock),
      after: d,
      reason: String(n).trim(),
      date: nowIso(),
    },
    ...getCollection(i, "adjustments"),
  ];
  appendAuditEntry(
    i,
    `Stock ${t > 0 ? "+" : ""}${t} · ${getRecordLabel("warehouses", c)}`,
    "products",
    f,
  );
  writeCommerceState(i);
  return f;
}
