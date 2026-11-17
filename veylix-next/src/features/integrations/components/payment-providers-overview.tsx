// @ts-nocheck
import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { IntegrationGuideDialog } from "@/features/integrations/components/integration-guide-dialog";
import { ProviderConnectionDialog } from "@/features/integrations/components/provider-connection-dialog";
import { PaymentWorkspaceNav } from "@/features/payments/components/payment-workspace-nav";
import {
  getPaymentProvidersOverview,
  getProviderPaymentMetrics,
} from "@/features/payments/lib/payment-metrics";
import { formatCurrency } from "@/lib/format";
import { buildHref } from "@/lib/navigation";
import { readPreference } from "@/lib/store/preferences";

export function PaymentProvidersOverview({
  providers,
  revision,
  onConfigure,
  onGuide,
  dialog,
  close: a,
  saved,
}) {
  const s = providers.filter(
    (e) => readPreference(`connection-${e.id}`, {}).secretRef,
  ).length;
  const c = getPaymentProvidersOverview(
    providers.map((e) => e.name),
    s,
  );
  return (
    <Fragment>
      <CommercePageHeading
        title="Payment providers"
        actions={
          <Fragment>
            <Link
              className="secondary-button"
              href={buildHref("/commerce/methods")}
            >
              Checkout methods
              <Icon name="arrow-right" />
            </Link>
            <Link
              className="secondary-button"
              href={buildHref("/commerce/webhooks")}
            >
              Webhooks
              <Icon name="arrow-right" />
            </Link>
          </Fragment>
        }
      />
      <PaymentWorkspaceNav active="providers" />
      <section
        className="payment-summary-grid"
        aria-label="Payment provider overview"
      >
        <ProviderSummaryCard
          icon="globe"
          label="Configured providers"
          value={`${c.configured} / ${c.total}`}
          detail="Saved server references"
          tone="green"
        />
        <ProviderSummaryCard
          icon="check-circle"
          label="Charge success"
          value={`${c.successRate}%`}
          detail={`${c.successful} successful charge records`}
          tone="blue"
        />
        <ProviderSummaryCard
          icon="wallet"
          label="Open settlement"
          value={formatCurrency(c.openSettlement, 2)}
          detail="Pending, in transit or held"
          tone="amber"
        />
        <ProviderSummaryCard
          icon="seal-percent"
          label="Processing fees"
          value={formatCurrency(c.fees, 2)}
          detail="Across the demo payment ledger"
          tone="red"
        />
      </section>
      <section className="payment-provider-section">
        <div className="payment-list-heading">
          <div>
            <span>PROVIDER OPERATIONS</span>
            <h2>Payment providers</h2>
            <p>
              Keep server configuration references, transaction health and
              settlement context together.
            </p>
          </div>
          <small>
            {providers.length}
            {" supported adapters"}
          </small>
        </div>
        <div className="payment-provider-grid">
          {providers.map((e) => {
            const i = readPreference(`connection-${e.id}`, {});
            const a = getProviderPaymentMetrics(e.name);
            const o = !!i.secretRef;
            const s = a.review
              ? `${a.review} review item${a.review === 1 ? "" : "s"}`
              : a.failed
                ? `${a.failed} failed attempt${a.failed === 1 ? "" : "s"}`
                : a.held
                  ? `${a.held} settlement hold${a.held === 1 ? "" : "s"}`
                  : "No open provider exceptions";
            return (
              <article
                key={`${e.id}-${revision}`}
                className="glass-card payment-provider-card"
              >
                <div className="payment-provider-card-top">
                  <span className="payment-provider-mark">
                    <Icon name={e.icon} />
                  </span>
                  <div>
                    <small>{i.environment || "Not configured"}</small>
                    <h2>{e.name}</h2>
                  </div>
                  <span
                    className={`payment-config-state ${o ? "configured" : ""}`}
                  >
                    <i />
                    {o ? "Config saved" : "Needs setup"}
                  </span>
                </div>
                <p>{e.description}</p>
                <div className="payment-provider-metrics">
                  <div>
                    <small>Captured volume</small>
                    <strong>{formatCurrency(a.volume, 2)}</strong>
                  </div>
                  <div>
                    <small>Charge success</small>
                    <strong>{a.successRate}%</strong>
                  </div>
                  <div>
                    <small>Fees</small>
                    <strong>{formatCurrency(a.fees, 2)}</strong>
                  </div>
                  <div>
                    <small>Open settlement</small>
                    <strong>{formatCurrency(a.openSettlement, 2)}</strong>
                  </div>
                </div>
                <div
                  className={`payment-provider-health ${a.health === "Healthy" ? "healthy" : a.health === "Review" ? "review" : ""}`}
                >
                  <span>
                    <Icon
                      name={a.health === "Healthy" ? "check-circle" : "info"}
                    />
                  </span>
                  <div>
                    <small>Operational health</small>
                    <strong>{a.health}</strong>
                    <em>{s}</em>
                  </div>
                </div>
                <div className="payment-provider-config">
                  <span>
                    <small>Server secret</small>
                    <strong>{i.secretRef || e.env}</strong>
                  </span>
                  <span>
                    <small>Webhook secret</small>
                    <strong>
                      {i.webhookSecretRef || e.webhookEnv || "Not set"}
                    </strong>
                  </span>
                  <span>
                    <small>Settlement</small>
                    <strong>
                      {i.settlementSchedule || "Provider default"}
                    </strong>
                  </span>
                  <span>
                    <small>Latest batch</small>
                    <strong>{String(a.latest?.reference || "No batch")}</strong>
                  </span>
                </div>
                <div className="payment-provider-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onConfigure(e)}
                  >
                    <Icon name="gear" />
                    {" Configure"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onGuide(e)}
                  >
                    Integration guide
                  </button>
                  <Link
                    className="secondary-button"
                    href={buildHref("/commerce/transactions")}
                  >
                    View transactions
                    <Icon name="arrow-right" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <section className="glass-card payment-security-card">
        <span>
          <Icon name="info" />
        </span>
        <div>
          <h2>Provider-safe by design</h2>
          <p>
            Veylix stores environment-variable names and operating preferences
            in this browser demo—never provider API secrets. Real captures,
            refunds, disputes and settlement verification belong on your
            authenticated backend with signed webhook validation.
          </p>
        </div>
        <Link className="primary-button" href={buildHref("/commerce/webhooks")}>
          Review webhooks
          <Icon name="arrow-right" />
        </Link>
      </section>
      {dialog?.mode === "configure" ? (
        <ProviderConnectionDialog
          connection={dialog.connection}
          onClose={a}
          onSaved={() => saved(dialog.connection)}
        />
      ) : null}
      {dialog?.mode === "guide" ? (
        <IntegrationGuideDialog connection={dialog.connection} onClose={a} />
      ) : null}
    </Fragment>
  );
}

function ProviderSummaryCard({ icon, label, value, detail, tone = "" }) {
  return (
    <article className={`payment-summary-card ${tone}`}>
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </article>
  );
}
