// @ts-nocheck
import { listRecords } from "@/lib/store/core";

export const marketplaceReviewStatusOptions = [
  "Pending",
  "Under review",
  "Changes requested",
  "Approved",
  "Rejected",
];

export function getMarketplaceReviewTone(e) {
  const t = String(e || "");
  return /approved|verified|complete|passed|ready|low/i.test(t)
    ? "green"
    : /pending|review|partial|medium|changes/i.test(t)
      ? "amber"
      : /rejected|missing|blocked|high/i.test(t)
        ? "red"
        : "blue";
}

export function getApplicationReadinessScore(e) {
  let t = 20;
  if (e.documents === "Complete") {
    t += 30;
  } else if (e.documents === "Partial") {
    t += 15;
  }
  if (["Verified", "In review"].includes(String(e.verification || ""))) {
    t += e.verification === "Verified" ? 25 : 15;
  }
  if (e.risk === "Low") {
    t += 15;
  } else if (e.risk === "Medium") {
    t += 7;
  }
  if (e.taxId) {
    t += 5;
  }
  if (e.website) {
    t += 5;
  }
  return Math.min(100, t);
}

export function summarizeVendorApplications(e = listRecords("applications")) {
  return {
    waiting: e.filter((e) =>
      ["Pending", "Under review", "Changes requested"].includes(
        String(e.status || ""),
      ),
    ).length,
    ready: e.filter(
      (e) => e.documents === "Complete" && e.status !== "Rejected",
    ).length,
    risk: e.filter(
      (e) =>
        ["Medium", "High"].includes(String(e.risk || "")) &&
        !["Approved", "Rejected"].includes(String(e.status || "")),
    ).length,
    approved: e.filter((e) => e.status === "Approved").length,
  };
}

export function getListingApprovalScore(e) {
  const t = Math.max(0, Math.min(100, Number(e.completeness || 0)));
  let n = 0;
  if (e.images === "Ready") {
    n += 1;
  }
  if (["Ready", "Not applicable"].includes(String(e.variants || ""))) {
    n += 1;
  }
  if (e.seo === "Ready") {
    n += 1;
  }
  if (e.compliance === "Passed") {
    n += 1;
  }
  return Math.round(t * 0.7 + (n / 4) * 100 * 0.3);
}

export function summarizeListingApprovals(e = listRecords("approvals")) {
  return {
    waiting: e.filter((e) =>
      ["Pending", "Under review"].includes(String(e.status || "")),
    ).length,
    changes: e.filter((e) => e.status === "Changes requested").length,
    compliant: e.filter((e) => e.compliance === "Passed").length,
    average: e.length
      ? Math.round(
          e.reduce((e, t) => e + getListingApprovalScore(t), 0) / e.length,
        )
      : 0,
    blockers: e.filter((e) => e.compliance === "Blocked" || e.risk === "High")
      .length,
  };
}
