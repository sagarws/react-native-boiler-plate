// @ts-nocheck
import { listRecords } from "@/lib/store/core";

export function getSignedTransactionAmount(e) {
  const t = Math.abs(Number(e.amount || 0));
  return e.type === "Refund" ? -t : t;
}

export function getTransactionNetAmount(e) {
  const t = getSignedTransactionAmount(e);
  return t < 0 ? t : t - Number(e.fee || 0);
}

export function getTransactionMetrics(e = listRecords("transactions")) {
  const t = e
    .filter(
      (e) =>
        e.type === "Charge" &&
        ["Succeeded", "Refunded"].includes(String(e.status || "")),
    )
    .reduce((e, t) => e + Number(t.amount || 0), 0);
  const n = e.filter(
    (e) =>
      ["Succeeded", "Refunded"].includes(String(e.status || "")) &&
      e.type !== "Authorization",
  );
  const r = n
    .filter((e) => e.type !== "Refund")
    .reduce((e, t) => e + Number(t.fee || 0), 0);
  const i = n.reduce((e, t) => e + getTransactionNetAmount(t), 0);
  const a = n
    .filter((e) =>
      ["Pending", "In transit", "On hold"].includes(String(e.settlement || "")),
    )
    .reduce((e, t) => e + Math.max(0, getTransactionNetAmount(t)), 0);
  const o = e.filter(
    (e) =>
      ["Failed", "Requires action"].includes(String(e.status || "")) ||
      ["High", "Review"].includes(String(e.risk || "")) ||
      e.reconciliation === "Needs review",
  ).length;
  const s = e.filter((e) => e.type === "Charge");
  const c = s.filter((e) =>
    ["Succeeded", "Refunded"].includes(String(e.status || "")),
  );
  const l = e.filter((e) =>
    ["Failed", "Requires action"].includes(String(e.status || "")),
  );
  const u = e
    .filter((e) => e.type === "Refund" || e.status === "Refunded")
    .reduce((e, t) => e + Math.abs(Number(t.amount || 0)), 0);
  const d = s.length ? (c.length / s.length) * 100 : 0;
  const f = t ? (r / t) * 100 : 0;
  return {
    captured: t,
    fees: r,
    net: i,
    pending: a,
    attention: o,
    charges: s.length,
    succeeded: c.length,
    failed: l.length,
    refunds: u,
    successRate: d,
    feeRate: f,
  };
}

export function getProviderPaymentMetrics(e) {
  const t = listRecords("transactions").filter((t) => t.provider === e);
  const n = t.filter((e) => e.type === "Charge");
  const r = n.filter((e) =>
    ["Succeeded", "Refunded"].includes(String(e.status || "")),
  );
  const i = r.reduce((e, t) => e + Number(t.amount || 0), 0);
  const a = t
    .filter((e) => e.type !== "Refund")
    .reduce((e, t) => e + Number(t.fee || 0), 0);
  const o = n.length ? Math.round((r.length / n.length) * 100) : 0;
  const s = listRecords("settlements").filter((t) => t.provider === e);
  const c = s
    .filter((e) => e.status !== "Paid")
    .reduce((e, t) => e + Number(t.net || 0), 0);
  const l = [...s].sort((e, t) =>
    String(t.expected || "").localeCompare(String(e.expected || "")),
  )[0];
  const u = n.filter((e) =>
    ["Failed", "Requires action"].includes(String(e.status || "")),
  ).length;
  const d = t.filter(
    (e) =>
      e.reconciliation === "Needs review" ||
      ["High", "Review"].includes(String(e.risk || "")),
  ).length;
  const f = s.filter((e) => e.status === "On hold").length;
  return {
    rows: t,
    volume: i,
    fees: a,
    successRate: o,
    openSettlement: c,
    latest: l,
    failed: u,
    review: d,
    held: f,
    health: t.length ? (u || d || f ? "Review" : "Healthy") : "No traffic",
  };
}

export function getPaymentProvidersOverview(e, t) {
  const n = listRecords("transactions");
  const r = n.filter((e) => e.type === "Charge");
  const i = r.filter((e) =>
    ["Succeeded", "Refunded"].includes(String(e.status || "")),
  ).length;
  const a = n
    .filter((e) => e.type !== "Refund")
    .reduce((e, t) => e + Number(t.fee || 0), 0);
  const o = listRecords("settlements")
    .filter((e) => e.status !== "Paid")
    .reduce((e, t) => e + Number(t.net || 0), 0);
  const s = r.length ? Math.round((i / r.length) * 100) : 0;
  return {
    configured: t,
    total: e.length,
    successful: i,
    fees: a,
    openSettlement: o,
    successRate: s,
  };
}

export function getSettlementMetrics(e = listRecords("settlements")) {
  const t = e.filter((e) => e.status !== "Paid");
  const n = t.reduce((e, t) => e + Number(t.net || 0), 0);
  const r = e.reduce((e, t) => e + Number(t.fees || 0), 0);
  const i = e.filter((e) => e.status === "On hold").length;
  return {
    total: e.length,
    openCount: t.length,
    openNet: n,
    fees: r,
    holds: i,
  };
}

export function getPaymentLinkMetrics(e = listRecords("payment-links")) {
  const t = e.filter((e) => e.status === "Active");
  const n = t.reduce((e, t) => e + Number(t.amount || 0), 0);
  const r = e
    .filter((e) => e.status === "Paid")
    .reduce(
      (e, t) => e + Number(t.amount || 0) * Math.max(1, Number(t.uses || 1)),
      0,
    );
  const i = e.filter((e) => e.status === "Draft").length;
  return {
    total: e.length,
    activeCount: t.length,
    outstanding: n,
    paidValue: r,
    drafts: i,
  };
}

export function getTransactionAttentionReason(e) {
  return e.status === "Failed"
    ? {
        label: "Payment failed",
        detail: "Provider attempt failed",
        tone: "critical",
        icon: "info",
      }
    : e.status === "Requires action"
      ? {
          label: "Customer action required",
          detail: "Payment cannot complete yet",
          tone: "action",
          icon: "timer",
        }
      : e.risk === "High"
        ? {
            label: "High-risk payment",
            detail: "Risk signal requires manual review",
            tone: "critical",
            icon: "info",
          }
        : e.risk === "Review"
          ? {
              label: "Risk review",
              detail: "Risk decision has not been cleared",
              tone: "review",
              icon: "info",
            }
          : {
              label: "Reconciliation review",
              detail: "Ledger match requires confirmation",
              tone: "review",
              icon: "history",
            };
}
