// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { formatCurrency } from "@/lib/format";
import { findRecord, listRecords } from "@/lib/store/core";

export function TransactionActivityList({ id, onClose }) {
  const n = findRecord("transactions", id);
  if (!n) return null;
  const r = listRecords("audit").filter(
    (t) => t.recordId === id || t.record === n.reference,
  );
  const i = [
    {
      title: `${String(n.type || "")} recorded`,
      copy: `${String(n.provider || "")} · ${String(n.method || "Payment method")} · ${formatCurrency(Math.abs(Number(n.amount || 0)), 2)}`,
      date: String(n.date || ""),
    },
    {
      title: `Settlement ${String(n.settlement || "Pending")}`,
      copy: String(n.settlementRef || "No provider settlement batch assigned"),
      date: String(n.date || ""),
    },
    {
      title: `Reconciliation ${String(n.reconciliation || "Unmatched")}`,
      copy: `Risk review: ${String(n.risk || "Normal")}`,
      date: String(n.date || ""),
    },
    ...r.map((e) => ({
      title: String(e.action || ""),
      copy: String(e.actor || "Local demo"),
      date: String(e.date || "").slice(0, 10),
    })),
  ];
  return (
    <AppDialog
      title={`${String(n.reference || "")} activity`}
      onClose={onClose}
      wide
    >
      <div className="payment-activity-list">
        {i.map((e, t) => (
          <div key={`${e.title}-${t}`}>
            <span>
              <Icon name="history" />
            </span>
            <div>
              <small>{e.date || "—"}</small>
              <strong>{e.title}</strong>
              <p>{e.copy}</p>
            </div>
          </div>
        ))}
      </div>
    </AppDialog>
  );
}
