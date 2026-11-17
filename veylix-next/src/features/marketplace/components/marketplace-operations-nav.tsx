// @ts-nocheck
import Link from "next/link";
import { buildHref } from "@/lib/navigation";

const marketplaceOperationsNavItems = [
  ["marketplace", "Overview"],
  ["vendors", "Vendors"],
  ["applications", "Applications"],
  ["approvals", "Product approvals"],
  ["vendor-orders", "Vendor orders"],
  ["commissions", "Commissions"],
  ["payouts", "Payouts"],
  ["disputes", "Disputes"],
  ["settings-marketplace", "Policy"],
];

export function MarketplaceOperationsNav({ active }) {
  return (
    <nav className="marketplace-review-nav" aria-label="Marketplace operations">
      {marketplaceOperationsNavItems.map(([t, n]) => (
        <Link
          key={t}
          href={buildHref(`/commerce/${t}`)}
          aria-current={t === active ? "page" : void 0}
        >
          {n}
        </Link>
      ))}
    </nav>
  );
}
