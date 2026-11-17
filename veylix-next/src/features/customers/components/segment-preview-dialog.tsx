// @ts-nocheck
import { useMemo } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import {
  getSegmentCustomerStats,
  getSegmentMatchingCustomers,
  getSegmentRules,
} from "@/features/customers/lib/segment-rules";
import { compactUsdFormatter } from "@/lib/intl-formatters";
import { findRecord } from "@/lib/store/core";

export function SegmentPreviewDialog({ recordId, onClose }) {
  const n = findRecord("segments", recordId);
  const r = useMemo(
    () => (n ? getSegmentMatchingCustomers(n) : []),
    [n?.id, n?.updatedAt],
  );
  if (!n) return null;
  const i = getSegmentRules(n);
  return (
    <AppDialog
      title={`${String(n.name || "Segment")} · preview`}
      onClose={onClose}
      wide
      className="ops-detail-dialog"
    >
      <div className="ops-detail-hero">
        <span>
          <Icon name="users" />
        </span>
        <div>
          <small>{String(n.logic || "Match all rules")}</small>
          <h2>
            {r.length}
            {" matching customers"}
          </h2>
          <p>
            {i.length}
            {" dynamic rule"}
            {i.length === 1 ? "" : "s"}
            {" evaluated against current records."}
          </p>
        </div>
        <StatusPill value={String(n.status || "Active")} />
      </div>
      <section className="segment-preview-rules">
        {i.map((e, t) => (
          <div key={`${e.condition}-${t}`}>
            <strong>{e.condition}</strong>
            <span>{e.value}</span>
          </div>
        ))}
      </section>
      <section className="segment-preview-list">
        <h3>Current matches</h3>
        {r.length ? (
          r.map((e) => {
            const t = getSegmentCustomerStats(e);
            return (
              <div key={e.id}>
                <strong>{String(e.name || "")}</strong>
                <span>
                  {String(e.segment || "")}
                  {" · "}
                  {t.orders}
                  {" orders · "}
                  {compactUsdFormatter.format(t.spend)}
                </span>
              </div>
            );
          })
        ) : (
          <p>No customers match the current rules.</p>
        )}
      </section>
    </AppDialog>
  );
}
