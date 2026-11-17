// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { formatApplicationDate } from "@/features/marketplace/lib/application-formatters";
import { findRecord } from "@/lib/store/core";

export function VendorApplicationActivityDialog({ id, onClose }) {
  const n = findRecord("applications", id);
  if (!n) return null;
  const r = [
    {
      date: n.submittedAt,
      title: "Application submitted",
      detail: `${String(n.businessType || "Vendor")} · ${String(n.country || "—")}`,
      icon: "clipboard-text",
    },
    ...(n.status === "Changes requested" ||
    n.verification === "Missing documents"
      ? [
          {
            date: n.updatedAt || n.submittedAt,
            title: "Documents requested",
            detail: String(
              n.notes || "Additional onboarding information requested.",
            ),
            icon: "paper-plane",
          },
        ]
      : []),
    ...(n.status === "Under review"
      ? [
          {
            date: n.updatedAt || n.submittedAt,
            title: "Verification review opened",
            detail: `Reviewer ${String(n.reviewer || "Unassigned")}`,
            icon: "eye",
          },
        ]
      : []),
    ...(n.decisionAt
      ? [
          {
            date: n.decisionAt,
            title: `Application ${String(n.status || "").toLowerCase()}`,
            detail: String(n.notes || "Decision recorded."),
            icon: n.status === "Approved" ? "check-circle" : "x",
          },
        ]
      : []),
  ];
  return (
    <AppDialog
      title={`${String(n.name)} · review activity`}
      onClose={onClose}
      wide
      className="vendor-detail-dialog marketplace-review-dialog"
    >
      <div className="vendor-activity-list">
        {r.map((e, t) => (
          <div key={`${e.title}-${t}`}>
            <span>
              <Icon name={e.icon} />
            </span>
            <div>
              <strong>{e.title}</strong>
              <small>{e.detail}</small>
            </div>
            <time>{formatApplicationDate(e.date)}</time>
          </div>
        ))}
      </div>
    </AppDialog>
  );
}
