// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { formatApprovalDate } from "@/features/marketplace/lib/approval-formatters";
import { findRecord } from "@/lib/store/core";

export function ListingApprovalActivityDialog({ id, onClose }) {
  const n = findRecord("approvals", id);
  if (!n) return null;
  const r = findRecord("products", String(n.productId || ""));
  const i = findRecord("vendors", String(n.vendorId || ""));
  const a = [
    {
      date: n.submittedAt,
      title: "Listing submitted for review",
      detail: `${String(i?.name || n.vendorId || "Vendor")} · ${Math.round(Number(n.completeness || 0))}% content complete`,
      icon: "shopping-bag",
    },
    ...(n.status === "Under review"
      ? [
          {
            date: n.updatedAt || n.submittedAt,
            title: "Moderation review opened",
            detail: `Reviewer ${String(n.reviewer || "Unassigned")}`,
            icon: "eye",
          },
        ]
      : []),
    ...(n.status === "Changes requested"
      ? [
          {
            date: n.updatedAt || n.submittedAt,
            title: "Changes requested",
            detail: String(n.feedback || "Vendor revision requested."),
            icon: "paper-plane",
          },
        ]
      : []),
    ...(n.decisionAt
      ? [
          {
            date: n.decisionAt,
            title: `Listing ${String(n.status || "").toLowerCase()}`,
            detail: String(n.feedback || "Decision recorded."),
            icon: n.status === "Approved" ? "check-circle" : "x",
          },
        ]
      : []),
  ];
  return (
    <AppDialog
      title={`${String(r?.name || "Product")} · decision activity`}
      onClose={onClose}
      wide
      className="vendor-detail-dialog marketplace-review-dialog"
    >
      <div className="vendor-activity-list">
        {a.map((e, t) => (
          <div key={`${e.title}-${t}`}>
            <span>
              <Icon name={e.icon} />
            </span>
            <div>
              <strong>{e.title}</strong>
              <small>{e.detail}</small>
            </div>
            <time>{formatApprovalDate(e.date)}</time>
          </div>
        ))}
      </div>
    </AppDialog>
  );
}
