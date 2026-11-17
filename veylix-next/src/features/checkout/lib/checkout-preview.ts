// @ts-nocheck
import { defaultCheckoutSettings } from "@/features/checkout/constants";
import { listRecords } from "@/lib/store/core";
import { readPreference } from "@/lib/store/preferences";

export function readCheckoutSettings() {
  const e = readPreference("checkout", defaultCheckoutSettings);
  return {
    ...defaultCheckoutSettings,
    ...(e || {}),
  };
}

export function formatCheckoutUsd(e, t = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: t,
    minimumFractionDigits: t,
  }).format(e);
}

export function getEligiblePaymentMethods(e, t) {
  return listRecords("methods")
    .filter((e) => e.status === "Enabled")
    .filter(
      (e) =>
        Number(e.minimum || 0) <= t && Number(e.maximum || 2 ** 53 - 1) >= t,
    )
    .filter((t) =>
      String(t.currencies || "")
        .split(",")
        .map((e) => e.trim())
        .includes(e.currency),
    )
    .sort((e, t) => Number(e.priority || 99) - Number(t.priority || 99));
}

export function calculateCheckoutDiscounts(e) {
  const t = Math.max(0, Number(e.orderValue || 0));
  const n = listRecords("discounts").filter(
    (e) => e.status === "Active" && t >= Number(e.minimum || 0),
  );
  const r = n
    .map((e) => {
      let n = 0;
      if (e.type === "Percentage") {
        n = (t * Math.max(0, Number(e.value || 0))) / 100;
      }
      if (e.type === "Fixed amount") {
        n = Math.max(0, Number(e.value || 0));
      }
      return {
        row: e,
        amount: Math.min(t, n),
      };
    })
    .sort((e, t) => t.amount - e.amount)[0];
  let i = Math.max(0, Number(e.shippingPreview || 0));
  if (n.some((e) => e.type === "Free shipping")) {
    i = 0;
  }
  const a = r?.amount || 0;
  const o = (Math.max(0, t - a) * Math.max(0, Number(e.taxRate || 0))) / 100;
  const s = Math.max(0, t - a + i + o);
  return {
    subtotal: t,
    discount: a,
    shipping: i,
    tax: o,
    total: s,
    offer: r?.row,
  };
}

export function validateCheckoutSettings(e) {
  const t = {
    ...defaultCheckoutSettings,
    ...e,
  };
  for (const e of ["orderValue", "shippingPreview", "taxRate"]) {
    const n = Number(t[e]);
    if (!Number.isFinite(n) || n < 0)
      throw Error(
        `Enter a valid ${e === "taxRate" ? "tax rate" : e === "orderValue" ? "preview subtotal" : "shipping amount"}.`,
      );
    t[e] = n;
  }
  if (Number(t.taxRate) > 100)
    throw Error("Preview tax rate cannot exceed 100%.");
  return t;
}
