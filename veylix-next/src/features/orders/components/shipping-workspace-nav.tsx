// @ts-nocheck
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { shippingWorkspaceTabs } from "@/features/orders/constants/shipping";
import { buildHref } from "@/lib/navigation";

export function ShippingWorkspaceNav({ active }) {
  return (
    <nav
      className="shipping-workspace-nav"
      aria-label="Shipping and fulfillment workspace"
    >
      {shippingWorkspaceTabs.map(([t, n, r]) => (
        <Link
          key={t}
          className={active === t ? "active" : void 0}
          href={buildHref(`/commerce/${t}`)}
        >
          <Icon name={r} />
          <span>{n}</span>
        </Link>
      ))}
    </nav>
  );
}

export function ShippingSummaryGrid({ items }) {
  return (
    <section
      className="shipping-summary-grid"
      aria-label="Shipping operations overview"
    >
      {items.map((e) => (
        <article
          key={e.label}
          className={`shipping-summary-card ${e.tone || ""}`.trim()}
        >
          <span>
            <Icon name={e.icon} />
          </span>
          <div>
            <small>{e.label}</small>
            <strong>{e.value}</strong>
            <em>{e.detail}</em>
          </div>
        </article>
      ))}
    </section>
  );
}
