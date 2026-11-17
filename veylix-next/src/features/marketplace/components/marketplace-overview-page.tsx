// @ts-nocheck
import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { buildMarketplaceOverview } from "@/features/marketplace/lib/marketplace-metrics";
import { formatCurrency } from "@/lib/format";
import { buildHref } from "@/lib/navigation";

const marketplaceGmvTrend = [
  54, 68, 61, 83, 72, 94, 88, 106, 118, 111, 132, 146,
];

function MarketplaceKpiCard({ icon, label, value, detail, tone = "green" }) {
  return (
    <article className={`marketplace-kpi ${tone}`}>
      <span className="marketplace-kpi-icon">
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

function MarketplaceQueueCard({ id, icon, title, value, copy, tone = "" }) {
  return (
    <Link
      className={`marketplace-queue-card ${tone}`}
      href={buildHref(`/commerce/${id}`)}
    >
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{title}</small>
        <strong>{value}</strong>
        <p>{copy}</p>
      </div>
      <Icon name="arrow-right" />
    </Link>
  );
}

export function MarketplaceOverviewPage() {
  const e = buildMarketplaceOverview();
  const t = Math.max(1, ...e.vendorRanking.map((e) => e.gmv));
  const n = Math.max(...marketplaceGmvTrend);
  const r = e.gmv ? `${((e.platform / e.gmv) * 100).toFixed(1)}%` : "—";
  return (
    <Fragment>
      <CommercePageHeading
        title="Marketplace overview"
        actions={
          <Link
            className="secondary-button"
            href={buildHref("/commerce/settings-marketplace")}
          >
            Marketplace settings
            <Icon name="arrow-right" />
          </Link>
        }
      />
      <section
        className="marketplace-command"
        aria-label="Marketplace command center"
      >
        <div className="marketplace-command-head">
          <div>
            <span>MARKETPLACE COMMAND CENTER</span>
            <h2>Partners, catalog and money flow.</h2>
            <p>
              Operate vendor health, snapshotted commission economics, approvals
              and settlements without leaving the commerce workspace.
            </p>
          </div>
          <div className="marketplace-health">
            <span>
              <i />
              {" Marketplace live"}
            </span>
            <strong>
              {e.active}/{e.vendors.length}
            </strong>
            <small>active partners</small>
          </div>
        </div>
        <div className="marketplace-kpi-grid">
          <MarketplaceKpiCard
            icon="chart-line-up"
            label="Marketplace GMV"
            value={formatCurrency(e.gmv, 2)}
            detail="Gross vendor order value"
          />
          <MarketplaceKpiCard
            icon="seal-percent"
            label="Platform earnings"
            value={formatCurrency(e.platform, 2)}
            detail={e.gmv ? `${r} effective take rate` : "No booked GMV"}
            tone="amber"
          />
          <MarketplaceKpiCard
            icon="wallet"
            label="Vendor payable"
            value={formatCurrency(e.payable, 2)}
            detail="Before queued settlements"
            tone="blue"
          />
          <MarketplaceKpiCard
            icon="timer"
            label="Pending payouts"
            value={formatCurrency(e.pendingPayouts, 2)}
            detail={`${e.pendingPayoutCount} settlement item${e.pendingPayoutCount === 1 ? "" : "s"}`}
            tone="red"
          />
          <MarketplaceKpiCard
            icon="users"
            label="Active vendors"
            value={String(e.active)}
            detail={`${e.verified} verified partner${e.verified === 1 ? "" : "s"}`}
          />
          <MarketplaceKpiCard
            icon="info"
            label="Review queue"
            value={String(e.queueCount)}
            detail={`${e.applications.length} applications · ${e.approvals.length} products · ${e.disputes.length} disputes`}
            tone={e.queueCount ? "amber" : "green"}
          />
        </div>
      </section>
      <div className="marketplace-overview-grid">
        <section className="glass-card marketplace-performance-card">
          <header>
            <div>
              <span>GMV MOMENTUM</span>
              <h2>Marketplace performance</h2>
              <p>Demo operating trend across the latest marketplace periods.</p>
            </div>
            <Link href={buildHref("/commerce/vendor-orders")}>
              {"Vendor orders "}
              <Icon name="arrow-right" />
            </Link>
          </header>
          <div className="marketplace-trend">
            <div className="marketplace-trend-copy">
              <strong>{formatCurrency(e.gmv, 2)}</strong>
              <span>Booked GMV</span>
              <em>+12.8% vs previous period</em>
            </div>
            <div
              className="marketplace-trend-bars"
              aria-label="Marketplace GMV trend"
            >
              {marketplaceGmvTrend.map((e, t) => (
                <i
                  key={t}
                  style={{
                    "--bar": `${Math.round((e / n) * 100)}%`,
                  }}
                  title={`Period ${t + 1}: ${e}`}
                />
              ))}
            </div>
          </div>
          <div className="marketplace-economics">
            <div>
              <span>Platform earnings</span>
              <strong>{formatCurrency(e.platform, 2)}</strong>
            </div>
            <div>
              <span>Vendor payable</span>
              <strong>{formatCurrency(e.payable, 2)}</strong>
            </div>
            <div>
              <span>Effective take rate</span>
              <strong>{r}</strong>
            </div>
          </div>
        </section>
        <section className="glass-card marketplace-vendor-card">
          <header>
            <div>
              <span>PARTNER HEALTH</span>
              <h2>Top vendors</h2>
              <p>GMV, commission contribution and payout readiness.</p>
            </div>
            <Link href={buildHref("/commerce/vendors")}>
              {"Manage vendors "}
              <Icon name="arrow-right" />
            </Link>
          </header>
          <div className="marketplace-vendor-ranking">
            {e.vendorRanking
              .slice(0, 4)
              .map(({ vendor, gmv, commission, payable }, a) => (
                <Link
                  key={vendor.id}
                  href={buildHref(
                    `/commerce/vendors?q=${encodeURIComponent(String(vendor.name || ""))}`,
                  )}
                >
                  <span className="marketplace-vendor-rank">{a + 1}</span>
                  <div className="marketplace-vendor-avatar">
                    {String(vendor.name || "V")
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((e) => e[0])
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div className="marketplace-vendor-rank-copy">
                    <strong>{String(vendor.name || "")}</strong>
                    <small>
                      {String(vendor.category || "Marketplace partner")}
                      {" · "}
                      {String(vendor.status || "Active")}
                    </small>
                    <i>
                      <b
                        style={{
                          width: `${Math.max(8, Math.round((gmv / t) * 100))}%`,
                        }}
                      />
                    </i>
                  </div>
                  <div className="marketplace-vendor-rank-money">
                    <strong>{formatCurrency(gmv, 2)}</strong>
                    <small>
                      {formatCurrency(commission, 2)}
                      {" fee · "}
                      {formatCurrency(payable, 2)}
                      {" net"}
                    </small>
                  </div>
                </Link>
              ))}
          </div>
        </section>
      </div>
      <section className="glass-card marketplace-queues">
        <header>
          <div>
            <span>OPERATIONS QUEUE</span>
            <h2>What needs attention</h2>
            <p>
              Keep onboarding, catalog moderation, settlements and support
              moving.
            </p>
          </div>
        </header>
        <div className="marketplace-queue-grid">
          <MarketplaceQueueCard
            id="applications"
            icon="clipboard-text"
            title="Vendor applications"
            value={String(e.applications.length)}
            copy={
              e.applications.length
                ? "Review business fit and verification documents."
                : "No partner applications waiting."
            }
            tone="amber"
          />
          <MarketplaceQueueCard
            id="approvals"
            icon="shopping-bag"
            title="Product approvals"
            value={String(e.approvals.length)}
            copy={
              e.approvals.length
                ? "Vendor listings are waiting for a catalog decision."
                : "Vendor catalog review is clear."
            }
            tone="green"
          />
          <MarketplaceQueueCard
            id="payouts"
            icon="wallet"
            title="Payout queue"
            value={formatCurrency(e.pendingPayouts, 2)}
            copy={
              e.pendingPayouts
                ? "Review release readiness before the next settlement run."
                : "No vendor balance is queued."
            }
            tone="blue"
          />
          <MarketplaceQueueCard
            id="disputes"
            icon="info"
            title="Open disputes"
            value={String(e.disputes.length)}
            copy={
              e.disputes.length
                ? "Evidence or a marketplace decision is still required."
                : "No unresolved marketplace disputes."
            }
            tone="red"
          />
        </div>
      </section>
      <section
        className="marketplace-tools"
        aria-label="Marketplace workspaces"
      >
        {[
          [
            "vendors",
            "users",
            "Vendors",
            "Profiles, catalog health, economics and payout controls.",
          ],
          [
            "commissions",
            "seal-percent",
            "Commission engine",
            "Layer marketplace, tier, category, vendor and product fee logic.",
          ],
          [
            "vendor-orders",
            "basket",
            "Vendor orders",
            "Split customer orders into vendor financial lines.",
          ],
          [
            "payouts",
            "wallet",
            "Settlements",
            "Review payable balances and payout batches.",
          ],
          [
            "approvals",
            "shopping-bag",
            "Catalog moderation",
            "Approve vendor products with a decision history.",
          ],
          [
            "settings-marketplace",
            "gear",
            "Marketplace policy",
            "Set onboarding, payouts, returns and ownership rules.",
          ],
        ].map(([e, t, n, r]) => (
          <Link
            key={e}
            className="marketplace-tool-card"
            href={buildHref(`/commerce/${e}`)}
          >
            <span>
              <Icon name={t} />
            </span>
            <div>
              <strong>{n}</strong>
              <small>{r}</small>
            </div>
            <Icon name="arrow-right" />
          </Link>
        ))}
      </section>
    </Fragment>
  );
}
