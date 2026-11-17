// @ts-nocheck
import { calculateCommissionBreakdown } from "@/features/marketplace/lib/commission";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";
import { readPreference } from "@/lib/store/preferences";
import { saveRecord } from "@/lib/store/records";

function toSettlementNumber(e) {
  return Number.isFinite(Number(e)) ? Number(e) : 0;
}

function getSettlementTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

const marketplaceSettlementDefaults = {
  commission: 12,
  approval: "Manual review",
  onboarding: "Verification required",
  payout: "Weekly",
  minimumPayout: 50,
  hold: 7,
  reserve: 5,
  returns: "Shared responsibility",
  refundLiability: "Case by case",
  shippingOwnership: "Hybrid",
  taxHandling: "Marketplace collects",
  discountPermission: "Allowed within guardrails",
  orderEditing: "Fulfillment fields only",
  customerData: "Order-only details",
  disputeSla: 7,
  suspension: "Hold payouts on high-risk dispute",
  branding: "Marketplace + vendor brand",
};

export function readMarketplaceSettlementSettings() {
  return readPreference("settings-marketplace", marketplaceSettlementDefaults);
}

export function computeVendorOrderSettlement(e) {
  return calculateCommissionBreakdown(
    e,
    findRecord("vendors", e.vendorId) || {},
    listRecords("commissions"),
  );
}

function getPayoutVendorOrders(e) {
  const t = listRecords("vendor-orders").filter(
    (t) => t.vendorId === e.vendorId && t.status !== "Cancelled",
  );
  const n = t.filter((t) => t.payoutId === e.id);
  return n.length
    ? n
    : t.filter((t) => {
        const n = String(t.date || "");
        return (
          (!e.periodStart || n >= e.periodStart) &&
          (!e.periodEnd || n <= e.periodEnd) &&
          (e.status === "Paid"
            ? t.payoutStatus === "Paid"
            : e.status === "On hold"
              ? t.payoutStatus === "On hold"
              : ["Ready", "Scheduled"].includes(t.payoutStatus))
        );
      });
}

function findPayoutEligibleVendorOrders(e, t, n, r = "") {
  return listRecords("vendor-orders").filter((i) => {
    if (i.vendorId !== e || i.status === "Cancelled") return false;
    const a = String(i.date || "");
    return (t && a < t) ||
      (n && a > n) ||
      computeVendorOrderSettlement(i).vendorNet <= 0
      ? false
      : i.payoutId === r || (!i.payoutId && i.payoutStatus === "Ready");
  });
}

export function calculatePayoutStatement(e) {
  const t = getPayoutVendorOrders(e);
  const n = t.map(computeVendorOrderSettlement);
  const r = n.reduce((e, t) => e + t.shopperGross, 0);
  const i = n.reduce((e, t) => e + t.netCommission + t.otherFees, 0);
  const a = n.reduce((e, t) => e + t.refundExposure, 0);
  const o = n.reduce((e, t) => e + t.vendorNet, 0);
  const s = Math.max(0, toSettlementNumber(e.reserveHeld));
  const c = toSettlementNumber(e.adjustment);
  const l = Math.max(0, o + c - s);
  return {
    splits: t,
    gross: r,
    commission: i,
    refunds: a,
    vendorNet: o,
    reserve: s,
    adjustment: c,
    calculated: l,
    amount: toSettlementNumber(e.amount ?? l),
  };
}

export function getPayoutSummary() {
  const e = listRecords("vendor-orders").filter((e) => e.status !== "Cancelled");
  const t = listRecords("payouts");
  return {
    available: e
      .filter((e) => e.payoutStatus === "Ready")
      .reduce((e, t) => e + computeVendorOrderSettlement(t).vendorNet, 0),
    readyLines: e.filter((e) => e.payoutStatus === "Ready").length,
    scheduled: t
      .filter((e) =>
        ["Draft", "Ready for processing", "Processing"].includes(e.status),
      )
      .reduce((e, t) => e + toSettlementNumber(t.amount), 0),
    scheduledCount: t.filter((e) =>
      ["Draft", "Ready for processing", "Processing"].includes(e.status),
    ).length,
    held: t
      .filter((e) => e.status === "On hold")
      .reduce((e, t) => e + toSettlementNumber(t.amount), 0),
    heldCount: t.filter((e) => e.status === "On hold").length,
    paid: t
      .filter((e) => e.status === "Paid")
      .reduce((e, t) => e + toSettlementNumber(t.amount), 0),
    paidCount: t.filter((e) => e.status === "Paid").length,
  };
}

function syncPayoutVendorOrders(e, t) {
  const n = findRecord("vendors", e.vendorId);
  const r = getPayoutVendorOrders(e);
  const i =
    t === "Paid"
      ? "Paid"
      : t === "On hold"
        ? "On hold"
        : ["Cancelled", "Failed"].includes(t)
          ? "Ready"
          : "Scheduled";
  r.forEach((t) =>
    saveRecord(
      "vendor-orders",
      {
        payoutStatus: i,
        payoutId: i === "Ready" ? "" : e.id,
      },
      t.id,
    ),
  );
  if (n) {
    if (t === "On hold") {
      saveRecord(
        "vendors",
        {
          payoutStatus: "On hold",
        },
        n.id,
      );
    } else if (
      n.kyc === "Verified" &&
      n.payoutStatus === "On hold" &&
      !listRecords("payouts").some(
        (t) => t.id !== e.id && t.vendorId === n.id && t.status === "On hold",
      )
    ) {
      saveRecord(
        "vendors",
        {
          payoutStatus: "Ready",
        },
        n.id,
      );
    }
  }
}

export function savePayoutBatch(e = {}, t = "") {
  const n = t ? findRecord("payouts", t) : void 0;
  if (n && ["Paid", "Cancelled"].includes(n.status))
    throw Error("Paid or cancelled payout batches are locked.");
  if (!findRecord("vendors", e.vendorId))
    throw Error("Choose a valid marketplace vendor.");
  if (n && n.vendorId !== e.vendorId)
    throw Error(
      "The vendor cannot be changed after a payout batch is created.",
    );
  if (
    e.periodStart &&
    e.periodEnd &&
    String(e.periodEnd) < String(e.periodStart)
  )
    throw Error("Settlement period end must be after the start date.");
  const r = n
    ? getPayoutVendorOrders(n)
    : findPayoutEligibleVendorOrders(
        e.vendorId,
        e.periodStart,
        e.periodEnd,
        "",
      );
  if (!r.length)
    throw Error(
      "No payout-ready vendor order lines are available in this settlement period.",
    );
  const i = r
    .map(computeVendorOrderSettlement)
    .reduce((e, t) => e + t.vendorNet, 0);
  const a = Math.max(0, toSettlementNumber(e.reserveHeld));
  const o = toSettlementNumber(e.adjustment);
  const s = Math.max(0, i + o - a);
  const c = findRecord("vendors", e.vendorId);
  const l = readMarketplaceSettlementSettings();
  const u = String(e.status || "Draft");
  if (
    ["Ready for processing", "Processing"].includes(u) &&
    c?.kyc !== "Verified"
  )
    throw Error("Verify the vendor before releasing this payout.");
  if (
    u === "Ready for processing" &&
    s < toSettlementNumber(l.minimumPayout || 0)
  )
    throw Error("This payout is below the marketplace minimum.");
  const d = saveRecord(
    "payouts",
    {
      ...e,
      amount: s,
      reserveHeld: a,
      adjustment: o,
      processedAt: n?.processedAt || "",
      date: n?.date || getSettlementTodayDate(),
    },
    t || void 0,
  );
  r.forEach((e) =>
    saveRecord(
      "vendor-orders",
      {
        payoutId: d.id,
        payoutStatus: d.status === "On hold" ? "On hold" : "Scheduled",
      },
      e.id,
    ),
  );
  syncPayoutVendorOrders(d, d.status);
  return d;
}

export function updatePayoutBatchStatus(e, t) {
  const n = findRecord("payouts", e);
  if (!n) throw Error("This payout batch is no longer available.");
  const r = findRecord("vendors", n.vendorId);
  const i = readMarketplaceSettlementSettings();
  if (
    ["Ready for processing", "Processing", "Paid"].includes(t) &&
    r?.kyc !== "Verified"
  )
    throw Error("Verify the vendor before releasing this payout.");
  if (
    t === "Ready for processing" &&
    toSettlementNumber(n.amount) < toSettlementNumber(i.minimumPayout)
  )
    throw Error("This payout is below the marketplace minimum.");
  const a = saveRecord(
    "payouts",
    {
      status: t,
      processedAt:
        t === "Paid" ? getSettlementTodayDate() : n.processedAt || "",
      holdReason: ["Cancelled", "Failed"].includes(t)
        ? n.holdReason || "Batch stopped before settlement."
        : t === "Paid"
          ? ""
          : n.holdReason,
    },
    e,
  );
  syncPayoutVendorOrders(a, t);
  return a;
}

export function togglePayoutBatchHold(e) {
  const t = findRecord("payouts", e);
  if (!t) throw Error("This payout batch is no longer available.");
  const n = t.status === "On hold";
  const r = findRecord("vendors", t.vendorId);
  if (n && r?.kyc !== "Verified")
    throw Error(
      "Vendor verification must be complete before releasing this payout hold.",
    );
  const i = saveRecord(
    "payouts",
    {
      status: n ? "Ready for processing" : "On hold",
      holdReason: n
        ? ""
        : t.holdReason || "Manual marketplace settlement hold.",
    },
    e,
  );
  syncPayoutVendorOrders(i, i.status);
  return i;
}

export function getDisputeVendorId(e) {
  return (
    e.vendorId ||
    listRecords("vendor-orders").find((t) => t.orderId === e.orderId)
      ?.vendorId ||
    ""
  );
}

export function getDisputeCustomerName(e) {
  const t = findRecord("orders", e.orderId);
  return t ? getRecordLabel("customers", t.customerId) : "Customer";
}

export function getDisputePayoutHoldScope(e) {
  const t = String(e?.payoutImpact || "");
  return /vendor payouts/i.test(t)
    ? "vendor"
    : /related payout/i.test(t)
      ? "related"
      : "none";
}

function getDisputeVendorOrderIds(e) {
  const t = getDisputeVendorId(e);
  return new Set(
    listRecords("vendor-orders")
      .filter(
        (n) =>
          n.vendorId === t &&
          n.orderId === e.orderId &&
          n.status !== "Cancelled",
      )
      .map((e) => e.id),
  );
}

function getDisputePayoutIds(e) {
  const t = getDisputeVendorOrderIds(e);
  return new Set(
    listRecords("vendor-orders")
      .filter((e) => t.has(e.id) && e.payoutId)
      .map((e) => e.payoutId),
  );
}

function isPayoutHeldByDispute(e, t) {
  return e.status === "Closed" ||
    getDisputePayoutHoldScope(e) === "none" ||
    getDisputeVendorId(e) !== t.vendorId
    ? false
    : getDisputePayoutHoldScope(e) === "vendor" ||
        getDisputePayoutIds(e).has(t.id);
}

function isVendorOrderHeldByDispute(e, t) {
  return e.status === "Closed" ||
    getDisputePayoutHoldScope(e) === "none" ||
    getDisputeVendorId(e) !== t.vendorId
    ? false
    : getDisputePayoutHoldScope(e) === "vendor" ||
        getDisputeVendorOrderIds(e).has(t.id);
}

function resolveVendorOrderPayoutStatus(e) {
  if (!e.payoutId) return "Ready";
  const t = findRecord("payouts", e.payoutId);
  return !t || ["Cancelled", "Failed"].includes(t.status)
    ? "Ready"
    : t.status === "Paid"
      ? "Paid"
      : t.status === "On hold"
        ? "On hold"
        : "Scheduled";
}

function applyDisputePayoutHold(e, t) {
  const n = getDisputeVendorId(e);
  const r = findRecord("vendors", n);
  const i = getDisputePayoutHoldScope(e);
  if (!n || i === "none") return;
  const a = i === "vendor" ? null : getDisputeVendorOrderIds(e);
  const o = i === "vendor" ? null : getDisputePayoutIds(e);
  const s = listRecords("payouts").filter(
    (e) =>
      e.vendorId === n &&
      !["Paid", "Cancelled"].includes(e.status) &&
      (i === "vendor" || o.has(e.id)),
  );
  const c = listRecords("vendor-orders").filter(
    (e) =>
      e.vendorId === n &&
      e.status !== "Cancelled" &&
      e.payoutStatus !== "Paid" &&
      (i === "vendor" || a.has(e.id)),
  );
  if (t) {
    s.forEach((t) =>
      saveRecord(
        "payouts",
        {
          status: "On hold",
          holdReason: `Marketplace dispute ${getRecordLabel("orders", e.orderId)}`,
        },
        t.id,
      ),
    );
    c.forEach((e) =>
      saveRecord(
        "vendor-orders",
        {
          payoutStatus: "On hold",
        },
        e.id,
      ),
    );
    if (r) {
      saveRecord(
        "vendors",
        {
          payoutStatus: "On hold",
        },
        r.id,
      );
    }
    return;
  }
  const l = listRecords("disputes").filter(
    (t) =>
      t.id !== e.id &&
      t.status !== "Closed" &&
      getDisputeVendorId(t) === n &&
      getDisputePayoutHoldScope(t) !== "none",
  );
  s.forEach((e) => {
    if (!l.some((t) => isPayoutHeldByDispute(t, e))) {
      saveRecord(
        "payouts",
        {
          status: e.status === "On hold" ? "Ready for processing" : e.status,
          holdReason: e.status === "On hold" ? "" : e.holdReason,
        },
        e.id,
      );
    }
  });
  c.forEach((e) => {
    if (!l.some((t) => isVendorOrderHeldByDispute(t, e))) {
      saveRecord(
        "vendor-orders",
        {
          payoutStatus: resolveVendorOrderPayoutStatus(e),
        },
        e.id,
      );
    }
  });
  const u = listRecords("disputes").some(
    (t) =>
      t.id !== e.id &&
      t.status !== "Closed" &&
      getDisputeVendorId(t) === n &&
      getDisputePayoutHoldScope(t) !== "none",
  );
  if (r && !u && r.kyc === "Verified") {
    saveRecord(
      "vendors",
      {
        payoutStatus: "Ready",
      },
      r.id,
    );
  }
}

export function getDisputeSummary() {
  const e = listRecords("disputes");
  const t = e.filter((e) => !["Resolved", "Closed"].includes(e.status));
  return {
    open: t.length,
    resolved: e.length - t.length,
    risk: t.reduce((e, t) => e + toSettlementNumber(t.amount), 0),
    evidence: t.filter((e) => e.evidence !== "Ready").length,
    holds: e.filter(
      (e) => e.status !== "Closed" && getDisputePayoutHoldScope(e) !== "none",
    ).length,
  };
}

export function saveDispute(e = {}, t = "") {
  if (!findRecord("orders", e.orderId))
    throw Error("Choose a valid customer order.");
  if (!findRecord("vendors", e.vendorId))
    throw Error("Choose a valid marketplace vendor.");
  if (
    !listRecords("vendor-orders").some(
      (t) => t.orderId === e.orderId && t.vendorId === e.vendorId,
    )
  )
    throw Error(
      "Choose the vendor that owns a marketplace line in this order.",
    );
  if (!String(e.reason || "").trim())
    throw Error("Add a reason for the dispute.");
  if (e.openedAt && e.deadline && String(e.deadline) < String(e.openedAt))
    throw Error("Response deadline must be after the case is opened.");
  const n = t ? findRecord("disputes", t) : void 0;
  const r = n && getDisputePayoutHoldScope(n) !== "none";
  const i = saveRecord(
    "disputes",
    {
      ...e,
      amount: toSettlementNumber(e.amount),
      resolution: n?.resolution || "Pending",
      resolvedAt: n?.resolvedAt || "",
    },
    t || void 0,
  );
  const a = getDisputePayoutHoldScope(i) !== "none";
  if (r && n.payoutImpact !== i.payoutImpact) {
    applyDisputePayoutHold(n, false);
  }
  if (a) {
    applyDisputePayoutHold(i, true);
  } else if (r) {
    applyDisputePayoutHold(n, false);
  }
  return i;
}

export function requestDisputeEvidence(e) {
  if (!findRecord("disputes", e))
    throw Error("This dispute is no longer available.");
  return saveRecord(
    "disputes",
    {
      evidence: "Requested",
      status: "Evidence required",
    },
    e,
  );
}

export function markDisputeUnderReview(e) {
  if (!findRecord("disputes", e))
    throw Error("This dispute is no longer available.");
  return saveRecord(
    "disputes",
    {
      status: "Under review",
    },
    e,
  );
}

export function toggleDisputePayoutHold(e) {
  const t = findRecord("disputes", e);
  if (!t) throw Error("This dispute is no longer available.");
  if (getDisputePayoutHoldScope(t) !== "none") {
    applyDisputePayoutHold(t, false);
    return saveRecord(
      "disputes",
      {
        payoutImpact: "No hold",
      },
      e,
    );
  }
  const n = {
    ...t,
    payoutImpact: "Hold vendor payouts",
  };
  const r = saveRecord(
    "disputes",
    {
      payoutImpact: "Hold vendor payouts",
    },
    e,
  );
  applyDisputePayoutHold(n, true);
  return r;
}

export function resolveDispute(
  e,
  { liability, resolution, payoutImpact, notes } = {},
) {
  const a = findRecord("disputes", e);
  if (!a) throw Error("This dispute is no longer available.");
  if (!String(notes || "").trim()) throw Error("Add resolution notes.");
  const o = [
    a.notes,
    `Resolution: ${resolution}. Liability: ${liability}. ${notes}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (getDisputePayoutHoldScope(a) !== "none") {
    applyDisputePayoutHold(a, false);
  }
  const s = saveRecord(
    "disputes",
    {
      liability: liability,
      resolution: resolution,
      payoutImpact: payoutImpact,
      status: "Resolved",
      evidence: a.evidence === "Missing" ? "Requested" : a.evidence,
      resolvedAt: getSettlementTodayDate(),
      notes: o,
    },
    a.id,
  );
  if (getDisputePayoutHoldScope(s) !== "none") {
    applyDisputePayoutHold(s, true);
  }
  if (
    resolution === "Refund customer" &&
    !listRecords("refunds").some((e) => e.orderId === a.orderId && !e._archived)
  ) {
    saveRecord("refunds", {
      orderId: a.orderId,
      amount: toSettlementNumber(a.amount),
      reason: "Goodwill",
      status: "Requested",
      notes: `Created from marketplace dispute ${a.id}.`,
    });
  }
  return s;
}

export function closeDispute(e) {
  const t = findRecord("disputes", e);
  if (!t) throw Error("This dispute is no longer available.");
  if (/hold/i.test(t.payoutImpact || "")) {
    applyDisputePayoutHold(t, false);
  }
  return saveRecord(
    "disputes",
    {
      status: "Closed",
      payoutImpact: "No hold",
    },
    e,
  );
}

export function getDisputeOrderTotal(e) {
  const t = findRecord("orders", e.orderId);
  return t ? calculateOrderTotal(t) : 0;
}
