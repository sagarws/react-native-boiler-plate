// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { StatusPill } from "@/components/ui/status-pill";
import { storeContentLinks, storeTools } from "@/config/online-store-tools";
import { StoreToolDialog } from "@/features/online-store/components/store-tool-dialog";
import { StorefrontPreviewDialog } from "@/features/online-store/components/storefront-preview-dialog";
import {
  getStoreToolSummary,
  getStorefrontSnapshot,
} from "@/features/online-store/lib/store-tools";
import { buildHref } from "@/lib/navigation";

function StorefrontMetric({ label, value, detail, glyph, tone = "" }) {
  return (
    <article className={`storefront-metric ${tone}`.trim()}>
      <span className="storefront-metric-icon">
        <Icon name={glyph} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

export function OnlineStorePage() {
  const [e, t] = useState(null);
  const [n, r] = useState(false);
  const [i, a] = useState(0);
  const o = useMemo(() => getStorefrontSnapshot(), [i]);
  const s = o.maintenance.mode === "Online";
  return (
    <Fragment>
      <CommercePageHeading
        title="Online store"
        actions={
          <button
            type="button"
            className="secondary-button"
            onClick={() => r(true)}
          >
            <Icon name="storefront" />
            {" Preview store"}
          </button>
        }
      />
      <section className="storefront-command glass-card">
        <div className="storefront-command-main">
          <span className="storefront-command-mark">
            <Icon name="storefront" />
          </span>
          <div>
            <div className="storefront-store-line">
              <h2>{String(o.general.storeName || "Veylix")}</h2>
              <StatusPill
                value={s ? "Live" : String(o.maintenance.mode || "Online")}
              />
            </div>
            <p>
              {String(o.domain.domain || "Domain not connected")}
              {" · "}
              {String(o.domain.ssl || "SSL not configured")}
              {" · "}
              {String(o.general.email || "No support email")}
            </p>
          </div>
        </div>
        <Link
          href={buildHref("/commerce/settings-general")}
          className="secondary-button"
        >
          {"Store identity "}
          <Icon name="arrow-right" />
        </Link>
      </section>
      <div className="storefront-metrics">
        <StorefrontMetric
          label="Published content"
          value={o.publishedContent}
          detail={"Pages & journal posts"}
          glyph="notebook"
          tone="green"
        />
        <StorefrontMetric
          label="Active products"
          value={o.activeProducts}
          detail="Visible catalog items"
          glyph="shopping-bag"
          tone="blue"
        />
        <StorefrontMetric
          label="Orders to fulfill"
          value={o.pendingOrders}
          detail="Needs an operations step"
          glyph="package"
          tone="amber"
        />
        <StorefrontMetric
          label="Store status"
          value={s ? "Online" : String(o.maintenance.mode || "")}
          detail={s ? "Storefront available" : "Review maintenance settings"}
          glyph="globe"
          tone={s ? "green" : "red"}
        />
      </div>
      <section
        className="storefront-section"
        aria-labelledby="storefront-config-title"
      >
        <div className="storefront-section-heading">
          <div>
            <span>STOREFRONT CONTROL CENTER</span>
            <h2 id="storefront-config-title">Store configuration</h2>
            <p>
              All the pieces a serious ecommerce storefront needs, kept compact
              and easy to reach.
            </p>
          </div>
          <Link
            href={buildHref("/commerce/settings-general")}
            className="text-link"
          >
            {"Advanced settings "}
            <Icon name="arrow-right" />
          </Link>
        </div>
        <div className="storefront-tool-grid">
          {storeTools.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`storefront-tool-card tone-${e.tone || "neutral"}`}
              onClick={() => t(e)}
            >
              <span className="storefront-tool-icon">
                <Icon name={e.icon} />
              </span>
              <span className="storefront-tool-copy">
                <strong>{e.title}</strong>
                <small>{e.description}</small>
                <em>{getStoreToolSummary(e)}</em>
              </span>
              <span className="storefront-tool-arrow">
                <Icon name="arrow-right" />
              </span>
            </button>
          ))}
        </div>
      </section>
      <section
        className="storefront-section storefront-content-section"
        aria-labelledby="storefront-content-title"
      >
        <div className="storefront-section-heading">
          <div>
            <span>{"CONTENT & CUSTOMER TOUCHPOINTS"}</span>
            <h2 id="storefront-content-title">Run the storefront</h2>
            <p>
              Your existing content tools stay one click away, now in a smaller
              and more useful layout.
            </p>
          </div>
        </div>
        <div className="storefront-content-grid">
          {storeContentLinks.map(([e, t, n, r]) => (
            <Link
              key={e}
              className="storefront-content-card"
              href={buildHref(`/commerce/${e}`)}
            >
              <span className="storefront-content-icon">
                <Icon name={r} />
              </span>
              <div>
                <strong>{t}</strong>
                <small>{n}</small>
              </div>
              <Icon name="arrow-right" />
            </Link>
          ))}
        </div>
      </section>
      {e ? (
        <StoreToolDialog
          tool={e}
          onClose={() => t(null)}
          onSaved={() => a((e) => e + 1)}
        />
      ) : null}
      {n ? <StorefrontPreviewDialog onClose={() => r(false)} /> : null}
    </Fragment>
  );
}
