// @ts-nocheck

export const STORE_PULSE_ROTATE_MS = 7e3;

export const storePulseSignalRoutes = {
  health: {
    icon: "storefront",
    path: "M600 8 V76 Q600 92 616 92 H704 Q724 92 724 112 V206",
    x: 724,
    y: 230,
  },
  delivery: {
    icon: "truck",
    path: "M600 8 V46 Q600 62 616 62 H1100 Q1120 62 1120 82 V562 Q1120 580 1102 580 H954 Q936 580 936 598 V616",
    x: 936,
    y: 640,
  },
  intake: {
    icon: "warehouse",
    path: "M600 8 V40 Q600 56 584 56 H90 Q70 56 70 76 V636 Q70 654 88 654 H286",
    x: 310,
    y: 654,
  },
  stock: {
    icon: "package",
    path: "M600 8 V44 Q600 60 584 60 H318 Q300 60 300 78 V290 Q300 308 318 308 H348 V360",
    x: 348,
    y: 384,
  },
  "low-stock": {
    icon: "package",
    path: "M600 8 V40 Q600 56 616 56 H1120 Q1140 56 1140 76 V374 Q1140 392 1122 392 H1040",
    x: 1016,
    y: 392,
  },
};

function computeExternalHealthScore(e) {
  return Math.max(
    0,
    100 -
      Object.values(e).reduce(
        (e, t) => e + (t === "offline" ? 20 : t === "degraded" ? 6 : 0),
        0,
      ),
  );
}

function describeStorePulseEvent(e) {
  if (e.kind === "health") {
    const t = computeExternalHealthScore(e.checks);
    const n = Object.entries(e.checks)
      .filter(([, e]) => e !== "healthy")
      .map(([e]) => e);
    return {
      title: `Store health · ${t}%`,
      detail: n.length
        ? `Needs attention: ${n.join(", ")}`
        : "All systems are running smoothly",
      tone: t === 100 ? "green" : "amber",
    };
  }
  const t = e.quantity.toLocaleString("en-US");
  return e.kind === "delivery"
    ? {
        title: `${t} ${e.quantity === 1 ? "product" : "products"} dispatched`,
        detail: e.detail,
        tone: "green",
      }
    : e.kind === "intake"
      ? {
          title: `${t} ${e.quantity === 1 ? "product" : "products"} received`,
          detail: e.detail,
          tone: "blue",
        }
      : e.kind === "stock"
        ? {
            title: `${e.product} · in stock`,
            detail: `${t} units available`,
            tone: "green",
          }
        : {
            title: `${e.product} · low stock`,
            detail: `${t} units left · time to restock`,
            tone: "red",
          };
}

export function toStorePulseActivity(e) {
  if (!e) return null;
  const t = describeStorePulseEvent(e);
  return {
    id: `external-${e.id}`,
    kind: e.kind,
    title: t.title,
    detail: t.detail,
    tone: t.tone,
    occurredAt: e.occurredAt,
  };
}
