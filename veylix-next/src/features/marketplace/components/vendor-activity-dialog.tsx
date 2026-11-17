// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { calculateCommissionBreakdown } from "@/features/marketplace/lib/commission";
import {
  getVendorOrders,
  getVendorPayouts,
} from "@/features/marketplace/lib/marketplace-metrics";
import {
  formatVendorDate,
  formatVendorMoney,
} from "@/features/marketplace/lib/vendor-format";
import { findRecord, listRecords } from "@/lib/store/core";

export function VendorActivityDialog({ id, onClose }) {
  const n = findRecord("vendors", id);
  if (!n) return null;
  const r = [
    ...(n.joinedAt
      ? [
          {
            date: String(n.joinedAt),
            title: "Vendor joined marketplace",
            detail: `${String(n.commissionPlan || "Standard")} plan · ${Number(n.commission || 0).toFixed(1)}% commission`,
            icon: "users",
          },
        ]
      : []),
    ...getVendorOrders(n).map((e) => {
      const t = calculateCommissionBreakdown(e, n, listRecords("commissions"));
      return {
        date: String(e.date || ""),
        title: `Vendor order ${String(findRecord("orders", String(e.orderId || ""))?.number || e.orderId || "")}`,
        detail: `${formatVendorMoney(t.shopperGross)} GMV · ${formatVendorMoney(t.vendorNet)} vendor net · ${String(e.status || "Pending")}`,
        icon: "basket",
      };
    }),
    ...getVendorPayouts(n).map((e) => ({
      date: String(e.date || ""),
      title: `Payout ${String(e.reference || "")}`,
      detail: `${formatVendorMoney(Number(e.amount || 0))} · ${String(e.status || "Draft")}`,
      icon: "wallet",
    })),
  ].sort((e, t) => t.date.localeCompare(e.date));
  return (
    <AppDialog
      title={`${String(n.name)} · activity`}
      onClose={onClose}
      wide
      className="vendor-detail-dialog"
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
            <time>{formatVendorDate(e.date)}</time>
          </div>
        ))}
      </div>
    </AppDialog>
  );
}
