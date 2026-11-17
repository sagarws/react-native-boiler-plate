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
  getVendorProducts,
} from "@/features/marketplace/lib/marketplace-metrics";
import {
  formatCommissionRate,
  formatVendorDate,
  formatVendorMoney,
  getVendorInitials,
} from "@/features/marketplace/lib/vendor-format";
import { buildHref } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";

export function VendorDetailDialog({
  id,
  onClose,
  onEdit,
  onFinance,
  onCommission,
}) {
  const a = findRecord("vendors", id);
  if (!a) return null;
  const o = buildVendorPerformance(a);
  const s = getVendorProducts(a);
  const c = getVendorOrders(a);
  const l = getVendorPayouts(a);
  const u = getVendorCommissionRule(a);
  return (
    <AppDialog
      title={String(a.name || "Vendor")}
      onClose={onClose}
      wide
      className="vendor-detail-dialog"
    >
      <div className="vendor-detail-hero">
        <div className="vendor-detail-avatar">{getVendorInitials(a)}</div>
        <div>
          <small>
            {String(a.category || "Marketplace partner")}
            {" · "}
            {String(a.country || "Global")}
          </small>
          <h2>{String(a.name || "")}</h2>
          <p>
            {String(a.owner || "Vendor contact")}
            {" · "}
            {String(a.email || "No email")}
          </p>
          <div>
            <VendorStatusPill value={a.status || "Active"} />
            <VendorStatusPill value={a.kyc || "Verified"} />
            <VendorStatusPill value={a.payoutStatus || "Ready"} />
          </div>
        </div>
        <div className="vendor-detail-score">
          <Icon name="star" />
          <strong>{o.rating ? o.rating.toFixed(1) : "—"}</strong>
          <small>vendor rating</small>
        </div>
      </div>
      <div className="vendor-detail-metrics">
        <div>
          <small>GMV</small>
          <strong>{formatVendorMoney(o.gmv)}</strong>
        </div>
        <div>
          <small>Platform earnings</small>
          <strong>{formatVendorMoney(o.commission)}</strong>
        </div>
        <div>
          <small>Vendor payable</small>
          <strong>{formatVendorMoney(o.payable)}</strong>
        </div>
        <div>
          <small>Products / orders</small>
          <strong>
            {o.products}
            {" / "}
            {o.orders}
          </strong>
        </div>
      </div>
      <div className="vendor-detail-grid">
        <section>
          <h3>Partner profile</h3>
          <dl>
            <div>
              <dt>Owner</dt>
              <dd>{String(a.owner || "—")}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{String(a.email || "—")}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{String(a.phone || "—")}</dd>
            </div>
            <div>
              <dt>Country</dt>
              <dd>{String(a.country || "—")}</dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>{formatVendorDate(a.joinedAt)}</dd>
            </div>
            <div>
              <dt>Catalog brand</dt>
              <dd>{String(a.brand || "Veylix Studio")}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Commercial terms</h3>
          <dl>
            <div>
              <dt>Commission plan</dt>
              <dd>{String(a.commissionPlan || "Standard")}</dd>
            </div>
            <div>
              <dt>Current base rule</dt>
              <dd>
                {String(u.name)}
                {" · "}
                {formatCommissionRate(u)}
              </dd>
            </div>
            <div>
              <dt>Payout status</dt>
              <dd>{String(a.payoutStatus || "Ready")}</dd>
            </div>
            <div>
              <dt>Queued payout</dt>
              <dd>{formatVendorMoney(o.queued)}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>{String(a.kyc || "Verified")}</dd>
            </div>
            <div>
              <dt>Vendor status</dt>
              <dd>{String(a.status || "Active")}</dd>
            </div>
          </dl>
        </section>
      </div>
      <section className="vendor-detail-section">
        <div>
          <h3>Catalog snapshot</h3>
          <span>
            {s.length}
            {" products"}
          </span>
        </div>
        <div className="vendor-product-chips">
          {s.slice(0, 6).map((e) => (
            <span key={e.id}>
              {String(e.name || "")}
              <small>{String(e.sku || "")}</small>
            </span>
          ))}
        </div>
      </section>
      <section className="vendor-detail-section">
        <div>
          <h3>Recent vendor orders</h3>
          <span>
            {c.length}
            {" lines"}
          </span>
        </div>
        <div className="vendor-finance-list">
          {c.slice(0, 5).map((e) => {
            const t = calculateCommissionBreakdown(
              e,
              a,
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
                  <small>
                    {String(e.status || "Pending")}
                    {" · "}
                    {formatCommissionRate(t.rule)}
                    {" · "}
                    {String(t.rule.name || "")}
                  </small>
                </span>
                <span>
                  <strong>{formatVendorMoney(t.shopperGross)}</strong>
                  <small>
                    {formatVendorMoney(t.vendorNet)}
                    {" vendor net"}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <div className="button-row vendor-detail-actions">
        <button className="secondary-button" type="button" onClick={onEdit}>
          Edit vendor
        </button>
        <button className="secondary-button" type="button" onClick={onFinance}>
          {"Finance & balances"}
        </button>
        <button className="primary-button" type="button" onClick={onCommission}>
          Adjust commission
        </button>
        {c.length ? (
          <Link
            className="secondary-button"
            href={buildHref(
              `/commerce/vendor-orders?q=${encodeURIComponent(String(a.name || ""))}`,
            )}
          >
            Vendor orders
          </Link>
        ) : null}
        {l.length ? (
          <Link
            className="secondary-button"
            href={buildHref("/commerce/payouts")}
          >
            Payout queue
          </Link>
        ) : null}
      </div>
    </AppDialog>
  );
}
