// @ts-nocheck
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { VendorStatusPill } from "@/features/marketplace/components/vendor-status-pill";
import { calculateCommissionBreakdown } from "@/features/marketplace/lib/commission";
import {
  buildVendorPerformance,
  getVendorCommissionRule,
  getVendorOrders,
  getVendorPayouts,
} from "@/features/marketplace/lib/marketplace-metrics";
import {
  formatCommissionRate,
  formatVendorMoney,
} from "@/features/marketplace/lib/vendor-format";
import { buildHref } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";

export function VendorFinanceDialog({ id, onClose, onToggleHold }) {
  const r = findRecord("vendors", id);
  if (!r) return null;
  const i = buildVendorPerformance(r);
  const a = getVendorOrders(r);
  const o = getVendorPayouts(r);
  const s = getVendorCommissionRule(r);
  return (
    <AppDialog
      title={`${String(r.name)} · finance`}
      onClose={onClose}
      wide
      className="vendor-detail-dialog"
    >
      <div className="vendor-finance-hero">
        <span>
          <Icon name="wallet" />
        </span>
        <div>
          <small>
            {String(r.commissionPlan || "Standard")}
            {" commission plan"}
          </small>
          <h2>{formatVendorMoney(i.payable)}</h2>
          <p>Vendor payable before settlement processing</p>
        </div>
        <VendorStatusPill value={r.payoutStatus || "Ready"} />
      </div>
      <div className="vendor-detail-metrics">
        <div>
          <small>Marketplace GMV</small>
          <strong>{formatVendorMoney(i.gmv)}</strong>
        </div>
        <div>
          <small>Platform earnings</small>
          <strong>{formatVendorMoney(i.commission)}</strong>
        </div>
        <div>
          <small>Queued payout</small>
          <strong>{formatVendorMoney(i.queued)}</strong>
        </div>
        <div>
          <small>Current base rule</small>
          <strong>{formatCommissionRate(s)}</strong>
        </div>
      </div>
      <section className="vendor-detail-section">
        <div>
          <h3>Order economics</h3>
          <span>
            {a.length}
            {" vendor lines"}
          </span>
        </div>
        <div className="vendor-finance-list">
          {a.map((e) => {
            const t = calculateCommissionBreakdown(
              e,
              r,
              listRecords("commissions"),
            );
            return (
              <div key={e.id}>
                <span>
                  <strong>
                    {String(
                      findRecord("orders", String(e.orderId || ""))?.number ||
                        e.orderId ||
                        "",
                    )}
                  </strong>
                  <small>{String(e.status || "Pending")}</small>
                </span>
                <span>
                  <strong>{formatVendorMoney(t.shopperGross)}</strong>
                  <small>
                    −{formatVendorMoney(t.netCommission + t.otherFees)}
                    {" fee · "}
                    {formatVendorMoney(t.vendorNet)}
                    {" net"}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="vendor-detail-section">
        <div>
          <h3>Payout queue</h3>
          <span>
            {o.length}
            {" requests"}
          </span>
        </div>
        <div className="vendor-finance-list">
          {o.map((e) => (
            <div key={e.id}>
              <span>
                <strong>{String(e.reference || "Payout")}</strong>
                <small>{String(e.date || "—")}</small>
              </span>
              <span>
                <strong>{formatVendorMoney(Number(e.amount || 0))}</strong>
                <small>{String(e.status || "Draft")}</small>
              </span>
            </div>
          ))}
        </div>
      </section>
      <div className="button-row">
        <button
          className="secondary-button"
          type="button"
          onClick={onToggleHold}
        >
          {r.payoutStatus === "On hold"
            ? "Release payout hold"
            : "Hold payouts"}
        </button>
        <Link
          className="secondary-button"
          href={buildHref("/commerce/payouts")}
        >
          Open payout center
        </Link>
      </div>
    </AppDialog>
  );
}
