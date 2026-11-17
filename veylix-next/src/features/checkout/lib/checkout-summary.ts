// @ts-nocheck
import { formatCurrency, formatNumber } from "@/lib/format";
import { listRecords } from "@/lib/store/core";

export const checkoutResourceIds = new Set([
  "methods",
  "coupons",
  "discounts",
  "promotions",
  "gift-cards",
  "campaigns",
]);

export const checkoutResourceLinks = [
  ["checkout", "Checkout"],
  ["methods", "Payment methods"],
  ["coupons", "Coupons"],
  ["discounts", "Automatic discounts"],
  ["promotions", "Promotions"],
  ["gift-cards", "Gift cards"],
  ["campaigns", "Campaigns"],
];

function readCheckoutResourceRows(e) {
  return listRecords(e);
}

export function buildCheckoutSummaryMetrics(e) {
  const t = readCheckoutResourceRows(e);
  if (e === "methods") {
    const e = t.filter((e) => e.status === "Enabled");
    const n = new Set(
      t.flatMap((e) =>
        String(e.currencies || "")
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
      ),
    ).size;
    return [
      ["Payment methods", t.length, `${e.length} enabled`],
      [
        "Express ready",
        t.filter(
          (e) =>
            e.status === "Enabled" &&
            ["Express checkout", "Both"].includes(String(e.placement || "")),
        ).length,
        "Accelerated placement",
      ],
      ["Currencies", n, "Configured across methods"],
      [
        "Offline methods",
        t.filter((e) => e.provider === "Offline" && e.status === "Enabled")
          .length,
        "Available without gateway",
      ],
    ];
  }
  if (e === "coupons") {
    const e = t.filter((e) => e.status === "Active");
    const n = t.reduce((e, t) => e + Number(t.used || 0), 0);
    const r = t.reduce((e, t) => e + Number(t.limit || 0), 0);
    return [
      ["Coupons", t.length, `${e.length} active`],
      ["Redemptions", formatNumber(n), "Recorded uses"],
      [
        "Usage capacity",
        formatNumber(r),
        r ? `${Math.round((n / r) * 100)}% consumed` : "No limits configured",
      ],
      [
        "Scheduled",
        t.filter((e) => e.status === "Scheduled").length,
        "Ready for a future window",
      ],
    ];
  }
  if (e === "discounts") {
    const e = t.filter((e) => e.status === "Active");
    return [
      ["Automatic offers", t.length, `${e.length} active`],
      [
        "Free shipping",
        e.filter((e) => e.type === "Free shipping").length,
        "Active shipping incentives",
      ],
      [
        "Scheduled",
        t.filter((e) => e.status === "Scheduled").length,
        "Upcoming offers",
      ],
      [
        "Top priority",
        e.length ? Math.min(...e.map((e) => Number(e.priority || 99))) : "—",
        "Lowest number applies first",
      ],
    ];
  }
  if (e === "promotions")
    return [
      ["Promotions", t.length, "Storefront offer calendar"],
      [
        "Active / scheduled",
        t.filter((e) =>
          ["Active", "Scheduled"].includes(String(e.status || "")),
        ).length,
        "Visible or upcoming",
      ],
      [
        "Website offers",
        t.filter((e) =>
          ["Website", "All channels"].includes(String(e.channel || "")),
        ).length,
        "Available to web shoppers",
      ],
      [
        "Drafts",
        t.filter((e) => e.status === "Draft").length,
        "Still being prepared",
      ],
    ];
  if (e === "gift-cards") {
    const e = t.reduce((e, t) => e + Number(t.value || 0), 0);
    const n = t.filter((e) =>
      ["Active", "Partially used"].includes(String(e.status || "")),
    );
    const r = n.reduce((e, t) => e + Number(t.balance || 0), 0);
    return [
      ["Gift cards", t.length, `${n.length} usable`],
      ["Issued value", formatCurrency(e, 0), "Original card value"],
      ["Outstanding balance", formatCurrency(r, 0), "Current liability"],
      [
        "Redeemed",
        t.filter((e) => e.status === "Redeemed").length,
        "Fully used cards",
      ],
    ];
  }
  if (e === "campaigns") {
    const e = t.reduce((e, t) => e + Number(t.budget || 0), 0);
    return [
      ["Campaigns", t.length, "Offer communications"],
      ["Budget planned", formatCurrency(e, 0), "Across listed campaigns"],
      [
        "Scheduled",
        t.filter((e) => e.status === "Scheduled").length,
        "Ready to launch",
      ],
      [
        "Drafts",
        t.filter((e) => e.status === "Draft").length,
        "Still being prepared",
      ],
    ];
  }
  return [["Total records", t.length, e]];
}
