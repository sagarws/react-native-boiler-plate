// @ts-nocheck

const catalogResourceRouteIds = [
  "variants",
  "categories",
  "brands",
  "collections",
  "tags",
  "reviews",
];

const orderResourceRouteIds = [
  "orders",
  "fulfillment",
  "deliveries",
  "carriers",
  "returns",
  "refunds",
  "cancellations",
  "abandoned",
];

const customerInventoryResourceRouteIds = [
  "customers",
  "segments",
  "stock",
  "warehouses",
  "adjustments",
  "transfers",
  "replenishment",
  "suppliers",
];

const checkoutResourceRouteIds = [
  "methods",
  "coupons",
  "discounts",
  "promotions",
  "gift-cards",
  "campaigns",
];

const storeContentResourceRouteIds = [
  "pages",
  "blog",
  "testimonials",
  "contacts",
  "popups",
  "faqs",
];

const marketplaceResourceRouteIds = [
  "vendors",
  "applications",
  "approvals",
  "vendor-orders",
  "commissions",
  "payouts",
  "disputes",
];

const customPageRouteIds = [
  "overview",
  "products",
  "profile",
  "product-new",
  "product-edit",
  "attributes",
  "checkout",
  "marketplace",
  "store",
  "menus",
  "chat",
  "ai-workflows",
  "ai-studio",
  "ai-voice",
  "media",
  "files",
  "permissions",
  "integrations",
  "providers",
];

const settingsRouteIds = [
  "settings-general",
  "settings-branding",
  "settings-localization",
  "settings-seo",
  "settings-maintenance",
  "settings-marketing",
  "settings-notifications",
  "settings-email",
  "settings-storage",
  "settings-security",
  "settings-marketplace",
];

const taxShippingResourceRouteIds = ["taxes", "shipping-rules"];

const paymentResourceRouteIds = [
  "transactions",
  "settlements",
  "payment-links",
  "webhooks",
];

const accessResourceRouteIds = ["users", "roles", "teams", "audit"];

const aiResourceRouteIds = [
  "knowledge",
  "prompts",
  "automations",
  "ai-history",
];

const communicationResourceRouteIds = [
  "tickets",
  "email",
  "email-templates",
  "notifications",
];

const reportRouteIds = [
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
];

const resourceModuleRouteIds = new Set([
  ...catalogResourceRouteIds,
  ...orderResourceRouteIds,
  ...customerInventoryResourceRouteIds,
  ...checkoutResourceRouteIds,
  ...marketplaceResourceRouteIds,
  ...storeContentResourceRouteIds,
  ...communicationResourceRouteIds,
  ...taxShippingResourceRouteIds,
  ...paymentResourceRouteIds,
  ...accessResourceRouteIds,
  ...aiResourceRouteIds,
]);

export function isResourceModuleRoute(e) {
  return !!(e && resourceModuleRouteIds.has(e));
}

export function isReportRoute(e) {
  return !!(e && reportRouteIds.includes(e));
}

export function isSettingsRoute(e) {
  return !!(e && settingsRouteIds.includes(e));
}

export function isKnownPageRoute(e) {
  return !!(
    e &&
    (customPageRouteIds.includes(e) ||
      resourceModuleRouteIds.has(e) ||
      reportRouteIds.includes(e) ||
      settingsRouteIds.includes(e))
  );
}
