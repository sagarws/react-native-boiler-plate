// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { CommissionStatusPill } from "@/features/marketplace/components/commission-status-pill";
import { normalizeCommissionRule } from "@/features/marketplace/lib/commission";
import {
  formatCommissionEffectiveWindow,
  formatCommissionMoney,
  formatCommissionRuleRate,
  getCommissionScopeTarget,
} from "@/features/marketplace/lib/commission-display";
import { findRecord } from "@/lib/store/core";

export function CommissionRuleDetailDialog({
  id,
  onClose,
  onEdit,
  onSimulate,
}) {
  const i = findRecord("commissions", id);
  if (!i) return null;
  const a = normalizeCommissionRule(i, {});
  return (
    <AppDialog
      title={String(i.name || "Commission rule")}
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
            {String(i.scope || "")}
            {" · priority "}
            {Number(i.priority || 0)}
          </small>
          <h2>{formatCommissionRuleRate(i)}</h2>
          <p>{getCommissionScopeTarget(i)}</p>
        </div>
        <CommissionStatusPill value={i.status} />
      </div>
      <div className="vendor-detail-metrics">
        <div>
          <small>Rate</small>
          <strong>{Number(i.rate || 0).toFixed(1)}%</strong>
        </div>
        <div>
          <small>Fixed fee</small>
          <strong>{formatCommissionMoney(Number(i.fixed || 0))}</strong>
        </div>
        <div>
          <small>Minimum</small>
          <strong>
            {Number(i.minimumFee || 0)
              ? formatCommissionMoney(Number(i.minimumFee || 0))
              : "None"}
          </strong>
        </div>
        <div>
          <small>Fee cap</small>
          <strong>
            {Number(i.feeCap || 0)
              ? formatCommissionMoney(Number(i.feeCap || 0))
              : "None"}
          </strong>
        </div>
      </div>
      <div className="vendor-detail-grid">
        <section>
          <h3>Matching logic</h3>
          <dl>
            <div>
              <dt>Scope</dt>
              <dd>{String(a.scope)}</dd>
            </div>
            <div>
              <dt>Value</dt>
              <dd>{getCommissionScopeTarget(i)}</dd>
            </div>
            <div>
              <dt>Effective</dt>
              <dd>{formatCommissionEffectiveWindow(i)}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{Number(i.priority || 0)}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Calculation policy</h3>
          <dl>
            <div>
              <dt>Base</dt>
              <dd>{String(a.commissionBase)}</dd>
            </div>
            <div>
              <dt>Shipping</dt>
              <dd>{String(a.shippingTreatment)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{String(a.taxTreatment)}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>{String(a.discountFunding)}</dd>
            </div>
            <div>
              <dt>Refund</dt>
              <dd>{String(a.refundPolicy)}</dd>
            </div>
          </dl>
        </section>
      </div>
      {i.notes ? (
        <section className="vendor-detail-section">
          <div>
            <h3>Rule note</h3>
          </div>
          <p>{String(i.notes)}</p>
        </section>
      ) : null}
      <div className="button-row vendor-detail-actions">
        <button type="button" className="secondary-button" onClick={onEdit}>
          Edit rule
        </button>
        <button type="button" className="primary-button" onClick={onSimulate}>
          Simulate
        </button>
      </div>
    </AppDialog>
  );
}
