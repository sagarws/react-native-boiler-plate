// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { VendorOrderStatusPill } from "@/features/marketplace/components/vendor-order-status-pill";
import { formatVendorOrderMoney } from "@/features/marketplace/data/vendor-orders";
import { calculateVendorOrderCommission } from "@/features/marketplace/lib/vendor-order-splits";
import {
  formatVendorOrderCommissionRate,
  formatVendorOrderDate,
  resolveVendorOrderRecordLabel,
} from "@/features/marketplace/lib/vendor-orders";
import { navigate } from "@/lib/navigation";
import { findRecord } from "@/lib/store/core";

export function VendorSplitDetailDialog({ id, onClose, onSnapshot }) {
  const r = findRecord("vendor-orders", id);
  if (!r) return null;
  const i = calculateVendorOrderCommission(r);
  return (
    <AppDialog
      title={`${resolveVendorOrderRecordLabel("orders", r.orderId)} · ${resolveVendorOrderRecordLabel("vendors", r.vendorId)}`}
      onClose={onClose}
      wide
      className="vendor-detail-dialog commission-detail-dialog"
    >
      <div className="vendor-split-detail-hero">
        <span>
          <Icon name="basket" />
        </span>
        <div>
          <small>
            {resolveVendorOrderRecordLabel("products", r.productId)}
            {" · "}
            {formatVendorOrderDate(r.date)}
          </small>
          <h2>{formatVendorOrderMoney(i.vendorNet)}</h2>
          <p>
            {"Vendor payable from "}
            {formatVendorOrderMoney(i.shopperGross)}
            {" shopper gross"}
          </p>
        </div>
        <VendorOrderStatusPill value={r.payoutStatus || "Unscheduled"} />
      </div>
      <div className="commission-result-flow">
        <div>
          <small>Item revenue</small>
          <strong>{formatVendorOrderMoney(i.itemRevenue)}</strong>
        </div>
        <span>
          <Icon name="arrow-right" />
        </span>
        <div>
          <small>Vendor discount</small>
          <strong>−{formatVendorOrderMoney(i.vendorDiscount)}</strong>
        </div>
        <span>
          <Icon name="arrow-right" />
        </span>
        <div>
          <small>Commission</small>
          <strong>−{formatVendorOrderMoney(i.netCommission)}</strong>
        </div>
        <span>
          <Icon name="arrow-right" />
        </span>
        <div>
          <small>Fees + refunds</small>
          <strong>
            −{formatVendorOrderMoney(i.otherFees + i.refundExposure)}
          </strong>
        </div>
        <span>
          <Icon name="arrow-right" />
        </span>
        <div>
          <small>Vendor net</small>
          <strong>{formatVendorOrderMoney(i.vendorNet)}</strong>
        </div>
      </div>
      <div className="vendor-detail-grid">
        <section>
          <h3>Shopper charge</h3>
          <dl>
            <div>
              <dt>Items</dt>
              <dd>{formatVendorOrderMoney(i.itemRevenue)}</dd>
            </div>
            <div>
              <dt>Shipping</dt>
              <dd>{formatVendorOrderMoney(i.shipping)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{formatVendorOrderMoney(i.tax)}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>−{formatVendorOrderMoney(i.discount)}</dd>
            </div>
            <div>
              <dt>Shopper gross</dt>
              <dd>{formatVendorOrderMoney(i.shopperGross)}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Marketplace deductions</h3>
          <dl>
            <div>
              <dt>Eligible base</dt>
              <dd>{formatVendorOrderMoney(i.eligibleBase)}</dd>
            </div>
            <div>
              <dt>Commission</dt>
              <dd>{formatVendorOrderMoney(i.commission)}</dd>
            </div>
            <div>
              <dt>Reversal</dt>
              <dd>−{formatVendorOrderMoney(i.commissionReversal)}</dd>
            </div>
            <div>
              <dt>Other fees</dt>
              <dd>{formatVendorOrderMoney(i.otherFees)}</dd>
            </div>
            <div>
              <dt>Refunds</dt>
              <dd>{formatVendorOrderMoney(i.refundExposure)}</dd>
            </div>
          </dl>
        </section>
      </div>
      <section className="vendor-detail-section">
        <div>
          <h3>Immutable commission snapshot</h3>
          <span>{String(r.ruleScope || i.rule.scope)}</span>
        </div>
        <div className="commission-snapshot-grid">
          <div>
            <small>Rule</small>
            <strong>{String(r.appliedRule || i.rule.name)}</strong>
          </div>
          <div>
            <small>Fee model</small>
            <strong>{formatVendorOrderCommissionRate(i.rule)}</strong>
          </div>
          <div>
            <small>Discount funding</small>
            <strong>{String(i.rule.discountFunding)}</strong>
          </div>
          <div>
            <small>Refund behavior</small>
            <strong>{String(i.rule.refundPolicy)}</strong>
          </div>
        </div>
      </section>
      <div className="button-row vendor-detail-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={() =>
            navigate(
              `/commerce/orders?q=${encodeURIComponent(resolveVendorOrderRecordLabel("orders", r.orderId))}`,
            )
          }
        >
          Customer order
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() =>
            navigate(
              `/commerce/vendors?q=${encodeURIComponent(resolveVendorOrderRecordLabel("vendors", r.vendorId))}`,
            )
          }
        >
          Vendor profile
        </button>
        <button className="primary-button" type="button" onClick={onSnapshot}>
          Commission snapshot
        </button>
      </div>
    </AppDialog>
  );
}
