// @ts-nocheck
import { listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";

export const segmentRuleConditions = [
  "Orders above",
  "Spend above",
  "Average order value above",
  "Last order before",
  "City equals",
  "Country equals",
  "Segment equals",
  "Status equals",
  "Marketing equals",
];

export function getSegmentCustomerStats(e) {
  const t = listRecords("orders").filter(
    (t) => t.customerId === e.id && t.status !== "Cancelled",
  );
  const n = t.reduce((e, t) => e + calculateOrderTotal(t), 0);
  const r =
    t
      .map((e) => String(e.date || ""))
      .sort()
      .at(-1) || "";
  return {
    orders: t.length,
    spend: n,
    aov: t.length ? n / t.length : 0,
    lastOrder: r,
  };
}

export function getSegmentRules(e) {
  return Array.isArray(e.rules) && e.rules.length
    ? e.rules
        .map((e) => ({
          condition: String(e.condition || ""),
          value: String(e.value || ""),
        }))
        .filter((e) => e.condition && e.value)
    : e.condition
      ? [
          {
            condition: String(e.condition),
            value: String(e.value || ""),
          },
        ]
      : [];
}

function customerMatchesSegmentRule(e, t) {
  const n = getSegmentCustomerStats(e);
  const r = String(t.value ?? "").trim();
  const i = t.condition || "";
  return i === "Orders above"
    ? n.orders > Number(r || 0)
    : i === "Spend above"
      ? n.spend > Number(r || 0)
      : i === "Average order value above"
        ? n.aov > Number(r || 0)
        : i === "Last order before"
          ? !!(n.lastOrder && r && n.lastOrder < r)
          : i === "City equals"
            ? String(e.city || "").toLowerCase() === r.toLowerCase()
            : i === "Country equals"
              ? String(e.country || "").toLowerCase() === r.toLowerCase()
              : i === "Segment equals"
                ? String(e.segment || "").toLowerCase() === r.toLowerCase()
                : i === "Status equals"
                  ? String(e.status || "").toLowerCase() === r.toLowerCase()
                  : i === "Marketing equals" &&
                    String(e.marketing || "").toLowerCase() === r.toLowerCase();
}

export function getSegmentMatchingCustomers(e) {
  const t = getSegmentRules(e);
  if (!t.length) return [];
  const n = e.logic === "Match any rule";
  return listRecords("customers").filter((e) =>
    n
      ? t.some((t) => customerMatchesSegmentRule(e, t))
      : t.every((t) => customerMatchesSegmentRule(e, t)),
  );
}

export function getSegmentSearchText(e) {
  return [
    ...Object.values(e),
    ...getSegmentRules(e).flatMap((e) => [e.condition, e.value]),
  ]
    .join(" ")
    .toLowerCase();
}

export function getSegmentInitials(e) {
  return String(e || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((e) => e[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function buildSegmentRuleDraft(e) {
  const t = e
    ? getSegmentRules(e)
    : [
        {
          condition: "Orders above",
          value: "2",
        },
      ];
  return [0, 1, 2].map((e) =>
    t[e]
      ? {
          ...t[e],
        }
      : {
          condition: "",
          value: "",
        },
  );
}
