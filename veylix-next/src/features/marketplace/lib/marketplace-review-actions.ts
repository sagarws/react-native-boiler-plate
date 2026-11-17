// @ts-nocheck
import { findRecord, listRecords } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

export function approveVendorApplication(e, t) {
  const n = findRecord("applications", e);
  if (!n) throw Error("This application is no longer available.");
  const r = Number(t.commission || 0);
  if (!Number.isFinite(r) || r < 0 || r > 100)
    throw Error("Commission must be between 0 and 100%.");
  const i = String(t.reviewer || "Alex Chen").trim() || "Alex Chen";
  const a = new Date().toISOString().slice(0, 10);
  saveRecord(
    "applications",
    {
      status: "Approved",
      documents: "Complete",
      verification: "Verified",
      reviewer: i,
      decisionAt: a,
    },
    n.id,
  );
  const o = listRecords("vendors").find(
    (e) =>
      String(e.email || "").toLowerCase() ===
        String(n.email || "").toLowerCase() ||
      String(e.name || "").toLowerCase() === String(n.name || "").toLowerCase(),
  );
  const s = saveRecord(
    "vendors",
    {
      name: n.name,
      owner: n.owner,
      email: n.email,
      phone: n.phone || "",
      category: n.category || "",
      brand: t.brand || "Veylix Studio",
      country: n.country || "",
      joinedAt: o?.joinedAt || a,
      commissionPlan: t.commissionPlan || "Standard",
      commission: r,
      rating: Number(o?.rating || 0),
      kyc: "Verified",
      payoutStatus: t.payoutStatus || "Setup required",
      status: "Active",
      notes: n.notes || o?.notes || "",
    },
    o?.id,
  );
  const c = listRecords("commissions").find(
    (e) =>
      e.scope === "Specific vendor" &&
      e.value === s.id &&
      e.status === "Active",
  );
  saveRecord(
    "commissions",
    {
      name: `${String(n.name)} onboarding terms`,
      priority: 40,
      scope: "Specific vendor",
      value: s.id,
      calculation: "Percentage",
      rate: r,
      fixed: 0,
      minimumFee: 0,
      feeCap: 0,
      commissionBase: "Item revenue after vendor discounts",
      shippingTreatment: "Exclude shipping",
      taxTreatment: "Exclude tax",
      discountFunding: "Vendor funded",
      refundPolicy: "Reverse commission",
      effectiveFrom: a,
      effectiveTo: "",
      status: "Active",
      notes:
        "Commercial terms created when the vendor application was approved.",
    },
    c?.id,
  );
  return s;
}

export function requestApplicationChanges(e, t, n) {
  const r = findRecord("applications", e);
  if (!r) throw Error("This application is no longer available.");
  const i = String(t || "Alex Chen").trim() || "Alex Chen";
  const a = String(n || "").trim();
  if (!a) throw Error("Describe the documents or information you need.");
  return saveRecord(
    "applications",
    {
      status: "Changes requested",
      documents: "Missing",
      verification: "Missing documents",
      reviewer: i,
      decisionAt: "",
      notes: [r.notes, `Follow-up requested by ${i}: ${a}`]
        .filter(Boolean)
        .join("\n"),
    },
    r.id,
  );
}

export function rejectVendorApplication(e, t, n) {
  const r = findRecord("applications", e);
  if (!r) throw Error("This application is no longer available.");
  const i = String(t || "Alex Chen").trim() || "Alex Chen";
  const a = String(n || "").trim();
  if (!a) throw Error("Add a reason for the rejection.");
  return saveRecord(
    "applications",
    {
      status: "Rejected",
      reviewer: i,
      decisionAt: new Date().toISOString().slice(0, 10),
      notes: [r.notes, `Rejected by ${i}: ${a}`].filter(Boolean).join("\n"),
    },
    r.id,
  );
}

export function approveListingReview(e) {
  const t = findRecord("approvals", e);
  if (!t) throw Error("This listing review is no longer available.");
  if (t.compliance === "Blocked")
    throw Error(
      "Resolve the compliance blocker before approving this listing.",
    );
  if (t.risk === "High")
    throw Error(
      "High-risk listings require a compliance review before approval.",
    );
  if (Number(t.completeness || 0) < 70)
    throw Error("Bring content completeness to at least 70% before approval.");
  return saveRecord(
    "approvals",
    {
      status: "Approved",
      decisionAt: new Date().toISOString().slice(0, 10),
      reviewer: t.reviewer || "Alex Chen",
      feedback: t.feedback || "Approved after marketplace catalog review.",
    },
    e,
  );
}

export function requestListingChanges(e, t, n) {
  const r = findRecord("approvals", e);
  if (!r) throw Error("This listing review is no longer available.");
  const i = String(t || "Alex Chen").trim() || "Alex Chen";
  const a = String(n || "").trim();
  if (!a) throw Error("Describe the changes the vendor should make.");
  const o = saveRecord(
    "approvals",
    {
      status: "Changes requested",
      reviewer: i,
      decisionAt: "",
      feedback: a,
    },
    r.id,
  );
  const s = findRecord("products", String(r.productId || ""));
  if (s && s.status !== "Draft") {
    saveRecord(
      "products",
      {
        status: "Draft",
      },
      s.id,
    );
  }
  return o;
}

export function rejectListingReview(e, t, n) {
  const r = findRecord("approvals", e);
  if (!r) throw Error("This listing review is no longer available.");
  const i = String(t || "Alex Chen").trim() || "Alex Chen";
  const a = String(n || "").trim();
  if (!a) throw Error("Add a reason for the rejection.");
  const o = saveRecord(
    "approvals",
    {
      status: "Rejected",
      reviewer: i,
      decisionAt: new Date().toISOString().slice(0, 10),
      feedback: a,
    },
    r.id,
  );
  const s = findRecord("products", String(r.productId || ""));
  if (s && s.status !== "Draft") {
    saveRecord(
      "products",
      {
        status: "Draft",
      },
      s.id,
    );
  }
  return o;
}
