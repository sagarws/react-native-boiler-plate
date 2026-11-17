// @ts-nocheck
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import {
  checkoutResourceIds,
  checkoutResourceLinks,
} from "@/features/checkout/lib/checkout-summary";
import { buildHref } from "@/lib/navigation";

const inventoryResourceIds = new Set([
  "warehouses",
  "transfers",
  "replenishment",
  "adjustments",
  "suppliers",
]);

const inventoryResourceLinks = [
  ["stock", "Stock overview"],
  ["warehouses", "Warehouses"],
  ["transfers", "Transfers"],
  ["replenishment", "Replenishment"],
  ["adjustments", "Adjustments"],
  ["suppliers", "Suppliers"],
];

const relatedResourceLinks = {
  orders: [
    ["customers", "Customers"],
    ["fulfillment", "Fulfillment"],
    ["deliveries", "Deliveries"],
    ["returns", "Returns"],
  ],
  stock: [
    ["warehouses", "Warehouses"],
    ["transfers", "Transfers"],
    ["replenishment", "Replenishment"],
    ["adjustments", "Adjustments"],
    ["suppliers", "Suppliers"],
  ],
  customers: [
    ["segments", "Customer segments"],
    ["orders", "Orders"],
    ["chat", "Customer inbox"],
  ],
  users: [
    ["roles", "Roles"],
    ["permissions", "Permissions"],
    ["teams", "Teams"],
  ],
  variants: [
    ["products", "Products"],
    ["attributes", "Attribute library"],
  ],
};

export function ResourceShortcuts({ moduleId, title }) {
  const n = checkoutResourceIds.has(moduleId)
    ? checkoutResourceLinks.filter(([t]) => t !== moduleId)
    : inventoryResourceIds.has(moduleId)
      ? inventoryResourceLinks.filter(([t]) => t !== moduleId)
      : relatedResourceLinks[moduleId];
  return n?.length ? (
    <nav className="resource-shortcuts" aria-label={`Related ${title} pages`}>
      {n.map(([e, t]) => (
        <Link
          key={e}
          className="secondary-button"
          href={buildHref(`/commerce/${e}`)}
        >
          {t}
          <Icon name="arrow-right" />
        </Link>
      ))}
    </nav>
  ) : null;
}
