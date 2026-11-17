// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { customerDateFormatter } from "@/features/customers/lib/customer-metrics";
import { findRecord } from "@/lib/store/core";
import { getCustomerTimeline } from "@/lib/store/customers";

export function CustomerTimeline({ row, limit = 8 }) {
  const n = getCustomerTimeline(row.id).slice(0, limit);
  return n.length ? (
    <div className="customer-timeline">
      {n.map((e, t) => {
        const n = String(e.type || "activity");
        const r = n === "order" ? "Order" : n === "note" ? "Note" : "Activity";
        const i = e.date ? new Date(String(e.date)) : void 0;
        const a =
          i && !Number.isNaN(i.getTime())
            ? customerDateFormatter.format(i)
            : "—";
        return (
          <div
            key={String(e.id || `${n}-${t}`)}
            className={`customer-timeline-item ${n}`}
          >
            <span>
              <Icon
                name={
                  n === "order" ? "cart" : n === "note" ? "notebook" : "history"
                }
              />
            </span>
            <div>
              <small>
                {r}
                {" · "}
                {a}
              </small>
              <strong>{String(e.title || "")}</strong>
              <p>{String(e.detail || "")}</p>
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <div className="customer-empty-note">No customer activity yet.</div>
  );
}

export function CustomerActivityDialog({ customerId, onClose }) {
  const n = findRecord("customers", customerId);
  return n ? (
    <AppDialog
      title={`${String(n.name || "Customer")} activity`}
      onClose={onClose}
      wide
    >
      <div className="customer-activity-dialog">
        <CustomerTimeline row={n} limit={50} />
      </div>
    </AppDialog>
  ) : null;
}
