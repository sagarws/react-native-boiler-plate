// @ts-nocheck

function toCommissionNumber(e) {
  return Number.isFinite(Number(e)) ? Number(e) : 0;
}

function roundCommissionAmount(e) {
  return Math.round((toCommissionNumber(e) + 2 ** -52) * 100) / 100;
}

const commissionScopeRanks = {
  "Marketplace default": 100,
  "Vendor tier": 200,
  "Vendor category": 300,
  "Specific vendor": 400,
  "Specific product": 500,
};

function isCommissionRuleEffective(e, t) {
  if (!e || e.status !== "Active") return false;
  const n = String(t || "").slice(0, 10);
  return (
    !n ||
    !(
      (e.effectiveFrom && n < String(e.effectiveFrom).slice(0, 10)) ||
      (e.effectiveTo && n > String(e.effectiveTo).slice(0, 10))
    )
  );
}

export function commissionScopeRank(e) {
  return commissionScopeRanks[e] || 0;
}

function commissionRuleMatches(e, { vendor, productId, date } = {}) {
  if (!isCommissionRuleEffective(e, date)) return false;
  const i = String(e.value || "");
  return e.scope === "Marketplace default"
    ? true
    : vendor
      ? e.scope === "Vendor tier"
        ? i === String(vendor.commissionPlan || "")
        : e.scope === "Vendor category"
          ? i.toLowerCase() === String(vendor.category || "").toLowerCase()
          : e.scope === "Specific vendor"
            ? i === vendor.id ||
              i.toLowerCase() === String(vendor.name || "").toLowerCase()
            : e.scope === "Specific product" && i === productId
      : false;
}

export function findApplicableCommissionRule({
  vendor,
  productId,
  date,
  rules = [],
} = {}) {
  return rules
    .filter((r) =>
      commissionRuleMatches(r, {
        vendor: vendor,
        productId: productId,
        date: date,
      }),
    )
    .sort(
      (e, t) =>
        commissionScopeRank(t.scope) - commissionScopeRank(e.scope) ||
        toCommissionNumber(t.priority) - toCommissionNumber(e.priority) ||
        String(t.effectiveFrom || "").localeCompare(
          String(e.effectiveFrom || ""),
        ),
    )[0];
}

export function normalizeCommissionRule(e = {}, t = {}) {
  return {
    id: e.id || "",
    name: e.name || `${t.name || "Vendor"} fallback`,
    scope: e.scope || "Specific vendor",
    value: e.value || t.id || "",
    calculation:
      e.calculation ||
      (toCommissionNumber(e.fixed) > 0
        ? "Percentage + fixed fee"
        : "Percentage"),
    rate: toCommissionNumber(e.rate ?? t.commission),
    fixed: toCommissionNumber(e.fixed),
    minimumFee: toCommissionNumber(e.minimumFee),
    feeCap: toCommissionNumber(e.feeCap),
    commissionBase: e.commissionBase || "Item revenue after vendor discounts",
    shippingTreatment: e.shippingTreatment || "Exclude shipping",
    taxTreatment: e.taxTreatment || "Exclude tax",
    discountFunding: e.discountFunding || "Vendor funded",
    refundPolicy: e.refundPolicy || "Reverse commission",
    priority: toCommissionNumber(e.priority),
    effectiveFrom: e.effectiveFrom || "",
    effectiveTo: e.effectiveTo || "",
  };
}

export function buildCommissionSnapshot(e = {}, t = {}) {
  const n = normalizeCommissionRule(e, t);
  return {
    appliedRuleId: n.id,
    appliedRule: n.name,
    ruleScope: n.scope,
    rate: n.rate,
    fixed: n.fixed,
    minimumFee: n.minimumFee,
    feeCap: n.feeCap,
    commissionBase: n.commissionBase,
    shippingTreatment: n.shippingTreatment,
    taxTreatment: n.taxTreatment,
    discountFunding: n.discountFunding,
    refundPolicy: n.refundPolicy,
  };
}

function commissionRuleFromSnapshot(e, t) {
  return normalizeCommissionRule(
    e
      ? {
          id: e.appliedRuleId || "",
          name: e.appliedRule || "Historical order snapshot",
          scope: e.ruleScope || "Specific vendor",
          rate: e.rate ?? t?.commission,
          fixed: e.fixed,
          minimumFee: e.minimumFee,
          feeCap: e.feeCap,
          commissionBase: e.commissionBase,
          shippingTreatment: e.shippingTreatment,
          taxTreatment: e.taxTreatment,
          discountFunding: e.discountFunding,
          refundPolicy: e.refundPolicy,
        }
      : {},
    t,
  );
}

export function calculateCommissionBreakdown(
  e = {},
  t = {},
  n = [],
  { useSnapshot = true } = {},
) {
  const i = e.date || e.createdAt || "";
  const a =
    useSnapshot && (e.appliedRule || e.rate != null)
      ? commissionRuleFromSnapshot(e, t)
      : normalizeCommissionRule(
          findApplicableCommissionRule({
            vendor: t,
            productId: e.productId,
            date: i,
            rules: n,
          }) || {},
          t,
        );
  const o = toCommissionNumber(e.itemRevenue ?? e.gross);
  const s = toCommissionNumber(e.shipping);
  const c = toCommissionNumber(e.tax);
  const l = toCommissionNumber(e.discount);
  let u = toCommissionNumber(e.vendorDiscount);
  let d = toCommissionNumber(e.marketplaceDiscount);
  if (!u && !d && l > 0) {
    if (a.discountFunding === "Marketplace funded") {
      d = l;
    } else if (a.discountFunding === "Shared") {
      u = roundCommissionAmount(l / 2);
      d = roundCommissionAmount(l - u);
    } else {
      u = l;
    }
  }
  const f = roundCommissionAmount(o + s + c - l);
  const p = roundCommissionAmount(o + s + c - u);
  let m = a.commissionBase === "Item revenue" ? o : Math.max(0, o - u);
  if (a.shippingTreatment === "Include shipping") {
    m += s;
  }
  if (a.taxTreatment === "Include tax") {
    m += c;
  }
  m = roundCommissionAmount(Math.max(0, m));
  let h = a.calculation === "Fixed fee" ? a.fixed : (m * a.rate) / 100;
  if (a.calculation === "Percentage + fixed fee") {
    h += a.fixed;
  }
  if (a.minimumFee > 0) {
    h = Math.max(h, a.minimumFee);
  }
  if (a.feeCap > 0) {
    h = Math.min(h, a.feeCap);
  }
  h = roundCommissionAmount(Math.max(0, h));
  const g = roundCommissionAmount(toCommissionNumber(e.refunds));
  const _ = roundCommissionAmount(toCommissionNumber(e.chargebacks));
  const v = g + _;
  const y = p > 0 ? Math.min(1, v / p) : 0;
  const b =
    a.refundPolicy === "Reverse commission" ? roundCommissionAmount(h * y) : 0;
  const x = roundCommissionAmount(Math.max(0, h - b));
  const S = roundCommissionAmount(toCommissionNumber(e.fees));
  const C = roundCommissionAmount(toCommissionNumber(e.adjustments));
  const w = roundCommissionAmount(Math.max(0, p - x - S - v + C));
  const T = roundCommissionAmount(x + S - d);
  return {
    rule: a,
    itemRevenue: roundCommissionAmount(o),
    shipping: roundCommissionAmount(s),
    tax: roundCommissionAmount(c),
    discount: roundCommissionAmount(l),
    vendorDiscount: roundCommissionAmount(u),
    marketplaceDiscount: roundCommissionAmount(d),
    shopperGross: f,
    vendorProceedsBeforeFees: p,
    eligibleBase: m,
    commission: h,
    commissionReversal: b,
    netCommission: x,
    otherFees: S,
    refunds: g,
    chargebacks: _,
    refundExposure: v,
    adjustments: C,
    vendorNet: w,
    platformNet: T,
    effectiveRate: m > 0 ? roundCommissionAmount((x / m) * 100) : 0,
  };
}
