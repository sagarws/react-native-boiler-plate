// @ts-nocheck
import { modulePath, modulesById } from "@/config/modules/registry";

function moduleNavItem(e) {
  return {
    id: e,
    label: modulesById[e].title,
    path: modulePath(e),
    icon: "caret-right",
    ready: true,
  };
}

function navGroup(e, t, n, r) {
  return {
    id: e,
    label: t,
    icon: n,
    children: r.map(moduleNavItem),
  };
}

export const navigationSections = [
  {
    label: "Operate",
    items: [
      {
        id: "overview",
        label: "Overview",
        icon: "house",
        path: "/overview",
        ready: true,
      },
      navGroup("catalog", "Products", "shopping-bag", [
        "products",
        "variants",
        "categories",
        "attributes",
        "brands",
        "collections",
        "tags",
        "reviews",
      ]),
      navGroup("order-management", "Orders", "clipboard-text", [
        "orders",
        "fulfillment",
        "deliveries",
        "carriers",
        "returns",
        "refunds",
        "cancellations",
        "abandoned",
      ]),
      navGroup("inventory-management", "Inventory", "warehouse", [
        "stock",
        "warehouses",
        "transfers",
        "replenishment",
        "adjustments",
        "suppliers",
      ]),
      navGroup("customer-management", "Customers", "users", [
        "customers",
        "segments",
      ]),
    ],
  },
  {
    label: "Commerce",
    items: [
      navGroup("checkout-pricing", "Checkout & pricing", "tag", [
        "checkout",
        "methods",
        "coupons",
        "discounts",
        "promotions",
        "gift-cards",
        "campaigns",
      ]),
      navGroup("marketplace-management", "Marketplace", "basket", [
        "marketplace",
        "vendors",
        "applications",
        "approvals",
        "vendor-orders",
        "commissions",
        "payouts",
        "disputes",
        "settings-marketplace",
      ]),
      navGroup("online-store", "Online store", "storefront", [
        "store",
        "menus",
        "pages",
        "blog",
        "testimonials",
        "contacts",
        "popups",
        "faqs",
      ]),
      navGroup("payment-management", "Payments", "wallet", [
        "transactions",
        "providers",
        "settlements",
        "payment-links",
      ]),
    ],
  },
  {
    label: "Grow & connect",
    items: [
      navGroup("reporting", "Reports", "chart-bar", [
        "report-sales",
        "report-orders",
        "report-products",
        "report-inventory",
        "report-customers",
        "report-returns",
        "report-channels",
        "report-payments",
        "report-vendors",
        "report-marketing",
      ]),
      navGroup("communication", "Communication", "chats-circle", [
        "chat",
        "tickets",
        "email",
        "email-templates",
        "notifications",
      ]),
      navGroup("ai-workspace", "Veylix AI", "sparkle", [
        "ai-workflows",
        "ai-studio",
        "ai-voice",
        "knowledge",
        "prompts",
        "automations",
        "ai-history",
      ]),
      navGroup("media-workspace", "Media & files", "notebook", [
        "media",
        "files",
      ]),
    ],
  },
  {
    label: "Workspace",
    items: [
      navGroup("access", "Team & access", "users", [
        "users",
        "roles",
        "permissions",
        "teams",
        "audit",
      ]),
      navGroup("developer", "Integrations", "globe", [
        "integrations",
        "webhooks",
      ]),
      navGroup("settings", "Settings", "gear", [
        "settings-general",
        "settings-branding",
        "settings-localization",
        "settings-seo",
        "settings-maintenance",
        "settings-marketing",
        "taxes",
        "shipping-rules",
        "settings-notifications",
        "settings-email",
        "settings-storage",
        "settings-security",
      ]),
    ],
  },
];

export const navigationRoutes = [
  ...navigationSections.flatMap((e) =>
    e.items.flatMap((t) =>
      t.children
        ? t.children.map((e) => ({
            ...e,
            group: t.label,
            icon: t.icon,
          }))
        : [
            {
              ...t,
              group: e.label,
            },
          ],
    ),
  ),
  {
    ...moduleNavItem("profile"),
    group: "Workspace",
  },
  ...["new", "edit"].map((e) => ({
    id: `product-${e}`,
    label: e === "new" ? "Add product" : "Edit product",
    path: `/commerce/products/${e}`,
    parentPath: "/commerce/products",
    group: "Products",
    icon: "shopping-bag",
    editor: "product",
    ready: true,
  })),
];

export const legacyPathAliases = {
  "/products": "products",
  "/orders": "orders",
  "/inventory": "stock",
  "/shipping": "fulfillment",
  "/fulfillment": "fulfillment",
  "/customers": "customers",
  "/store-channels": "store",
  "/marketplace": "marketplace",
  "/pricing": "checkout",
  "/promotions": "promotions",
  "/analytics": "report-sales",
  "/marketing": "campaigns",
  "/ai-assistant": "ai-studio",
  "/finances": "transactions",
};
