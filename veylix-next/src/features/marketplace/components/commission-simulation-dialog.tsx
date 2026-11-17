// @ts-nocheck
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { CommissionStatusPill } from "@/features/marketplace/components/commission-status-pill";
import {
  formatCommissionMoney,
  formatCommissionRuleRate,
} from "@/features/marketplace/lib/commission-display";
import { simulateCommission } from "@/features/marketplace/lib/commission-rules";
import { findRecord, listRecords } from "@/lib/store/core";

export function CommissionSimulationDialog({ ruleId, onClose }) {
  const n = ruleId ? findRecord("commissions", ruleId) : void 0;
  const r = listRecords("vendors")[0];
  const i = listRecords("products")[0];
  const a = n?.scope === "Specific vendor" ? String(n.value) : r?.id || "";
  const o = n?.scope === "Specific product" ? String(n.value) : i?.id || "";
  const [s, c] = useState("");
  const [u, d] = useState(null);
  return u ? (
    <AppDialog
      title="Simulation result"
      onClose={onClose}
      wide
      className="vendor-detail-dialog commission-detail-dialog"
    >
      <div className="commission-result-hero">
        <span>
          <Icon name="seal-percent" />
        </span>
        <div>
          <small>Resolved rule</small>
          <h2>{String(u.rule.name)}</h2>
          <p>
            {String(u.rule.scope)}
            {" · "}
            {formatCommissionRuleRate(u.rule)}
          </p>
        </div>
        <CommissionStatusPill value="Active" />
      </div>
      <div className="commission-result-flow">
        <div>
          <small>Shopper gross</small>
          <strong>{formatCommissionMoney(u.shopperGross)}</strong>
        </div>
        <span>
          <Icon name="arrow-right" />
        </span>
        <div>
          <small>Eligible base</small>
          <strong>{formatCommissionMoney(u.eligibleBase)}</strong>
        </div>
        <span>
          <Icon name="arrow-right" />
        </span>
        <div>
          <small>Commission</small>
          <strong>−{formatCommissionMoney(u.netCommission)}</strong>
        </div>
        <span>
          <Icon name="arrow-right" />
        </span>
        <div>
          <small>Vendor net</small>
          <strong>{formatCommissionMoney(u.vendorNet)}</strong>
        </div>
      </div>
      <div className="vendor-detail-grid">
        <section>
          <h3>Discount funding</h3>
          <dl>
            <div>
              <dt>Vendor funded</dt>
              <dd>{formatCommissionMoney(u.vendorDiscount)}</dd>
            </div>
            <div>
              <dt>Marketplace funded</dt>
              <dd>{formatCommissionMoney(u.marketplaceDiscount)}</dd>
            </div>
            <div>
              <dt>Refund exposure</dt>
              <dd>{formatCommissionMoney(u.refundExposure)}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Platform economics</h3>
          <dl>
            <div>
              <dt>Commission booked</dt>
              <dd>{formatCommissionMoney(u.commission)}</dd>
            </div>
            <div>
              <dt>Commission reversed</dt>
              <dd>{formatCommissionMoney(u.commissionReversal)}</dd>
            </div>
            <div>
              <dt>Platform net</dt>
              <dd>{formatCommissionMoney(u.platformNet)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </AppDialog>
  ) : (
    <AppDialog
      title="Commission simulator"
      onClose={onClose}
      wide
      className="vendor-detail-dialog commission-detail-dialog"
    >
      <form
        className="c-form commission-simulator-form"
        onSubmit={(e) => {
          e.preventDefault();
          c("");
          try {
            const t = new FormData(e.currentTarget);
            d(simulateCommission(Object.fromEntries(t)));
          } catch (e) {
            c(e instanceof Error ? e.message : "Simulation failed.");
          }
        }}
      >
        <fieldset>
          <legend>Simulation context</legend>
          <div className="c-form-grid">
            <FormField
              field={{
                key: "vendorId",
                label: "Vendor",
                type: "text",
                relation: "vendors",
                required: true,
              }}
              value={a}
              prefix="commission-sim"
            />
            <FormField
              field={{
                key: "productId",
                label: "Product",
                type: "text",
                relation: "products",
                required: true,
              }}
              value={o}
              prefix="commission-sim"
            />
            <FormField
              field={{
                key: "date",
                label: "Order date",
                type: "date",
                required: true,
              }}
              value="2026-05-15"
              prefix="commission-sim"
            />
          </div>
        </fieldset>
        <fieldset>
          <legend>Order economics</legend>
          <div className="c-form-grid">
            {[
              ["itemRevenue", "Item revenue", 100],
              ["shipping", "Shipping", 8],
              ["tax", "Tax", 6],
              ["discount", "Discount", 10],
              ["refunds", "Refunds / chargebacks", 0],
              ["fees", "Other marketplace fees", 0],
            ].map(([e, t, n]) => (
              <FormField
                key={String(e)}
                field={{
                  key: String(e),
                  label: String(t),
                  type: "money",
                  min: 0,
                  required: e === "itemRevenue",
                }}
                value={n}
                prefix="commission-sim"
              />
            ))}
          </div>
        </fieldset>
        <div className="commission-simulator-note">
          <Icon name="info" />
          <p>
            The engine resolves the most specific active rule for this vendor,
            product and date. Simulation never changes historical vendor orders.
          </p>
        </div>
        <p className="c-form-error" role="alert">
          {s}
        </p>
        <div className="c-form-footer">
          <button className="primary-button" type="submit">
            Run simulation
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
