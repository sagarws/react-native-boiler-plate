// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { VendorOrderStatusPill } from "@/features/marketplace/components/vendor-order-status-pill";
import { formatVendorOrderMoney } from "@/features/marketplace/data/vendor-orders";
import { calculateVendorOrderCommission } from "@/features/marketplace/lib/vendor-order-splits";
import {
  formatVendorOrderCommissionRate,
  formatVendorOrderDate,
} from "@/features/marketplace/lib/vendor-orders";
import { findRecord } from "@/lib/store/core";

export function VendorOrderCommissionSnapshotDialog({ id, onClose }) {
  const n = findRecord("vendor-orders", id);
  if (!n) return null;
  const r = calculateVendorOrderCommission(n);
  return (
    <AppDialog
      title="Commission snapshot"
      onClose={onClose}
      wide
      className="vendor-detail-dialog commission-detail-dialog"
    >
      <div className="commission-detail-hero">
        <span>
          <Icon name="seal-percent" />
        </span>
        <div>
          <small>
            {String(n.ruleScope || r.rule.scope)}
            {" · booked "}
            {formatVendorOrderDate(n.date)}
          </small>
          <h2>{String(n.appliedRule || r.rule.name)}</h2>
          <p>
            {formatVendorOrderCommissionRate(r.rule)}
            {" on "}
            {formatVendorOrderMoney(r.eligibleBase)}
            {" eligible revenue"}
          </p>
        </div>
        <VendorOrderStatusPill value="Historical snapshot" />
      </div>
      <div className="vendor-detail-grid">
        <section>
          <h3>Booked rule</h3>
          <dl>
            <div>
              <dt>Rate</dt>
              <dd>{Number(r.rule.rate || 0).toFixed(1)}%</dd>
            </div>
            <div>
              <dt>Fixed</dt>
              <dd>{formatVendorOrderMoney(Number(r.rule.fixed || 0))}</dd>
            </div>
            <div>
              <dt>Minimum</dt>
              <dd>{formatVendorOrderMoney(Number(r.rule.minimumFee || 0))}</dd>
            </div>
            <div>
              <dt>Cap</dt>
              <dd>
                {Number(r.rule.feeCap || 0)
                  ? formatVendorOrderMoney(Number(r.rule.feeCap || 0))
                  : "None"}
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Policy snapshot</h3>
          <dl>
            <div>
              <dt>Base</dt>
              <dd>{String(r.rule.commissionBase)}</dd>
            </div>
            <div>
              <dt>Shipping</dt>
              <dd>{String(r.rule.shippingTreatment)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{String(r.rule.taxTreatment)}</dd>
            </div>
            <div>
              <dt>Refund</dt>
              <dd>{String(r.rule.refundPolicy)}</dd>
            </div>
          </dl>
        </section>
      </div>
      <div className="commission-simulator-note">
        <Icon name="info" />
        <p>
          Editing today’s commission rules does not recalculate this historical
          vendor order line. The snapshot above stays attached to the order
          economics.
        </p>
      </div>
    </AppDialog>
  );
}
