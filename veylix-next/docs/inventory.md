# Veylix: inventory

The original build in `../resource/veylix-react.vercel.app` (a Vite + React 19 single-page app) is the source of truth for this list. Every item here exists in the Next.js app. 343 source files, about 78k lines including styles.

## Routes (99)

Defined in `src/config/navigation.ts` and served by `src/app/(dashboard)`:

- `overview/page.tsx`: the overview page.
- `commerce/[moduleId]/page.tsx`: one prerendered page per module.
- `commerce/products/page.tsx` and `commerce/products/[editorMode]/page.tsx`: the product list, and the product editor (`new` / `edit?id=…`).
- `[...unknownPath]/page.tsx`: the in-shell "Page not found" card.

| Page | Path | Group |
| --- | --- | --- |
| Overview | `/overview` | Operate |
| Products | `/commerce/products` | Products |
| Variants & options | `/commerce/variants` | Products |
| Categories | `/commerce/categories` | Products |
| Attributes | `/commerce/attributes` | Products |
| Brands | `/commerce/brands` | Products |
| Collections | `/commerce/collections` | Products |
| Tags | `/commerce/tags` | Products |
| Reviews & ratings | `/commerce/reviews` | Products |
| Orders | `/commerce/orders` | Orders |
| Fulfillment & tracking | `/commerce/fulfillment` | Orders |
| Delivery & shipment tracking | `/commerce/deliveries` | Orders |
| Carriers & service levels | `/commerce/carriers` | Orders |
| Returns | `/commerce/returns` | Orders |
| Refund requests | `/commerce/refunds` | Orders |
| Cancellations | `/commerce/cancellations` | Orders |
| Abandoned checkouts | `/commerce/abandoned` | Orders |
| Stock & availability | `/commerce/stock` | Inventory |
| Warehouses | `/commerce/warehouses` | Inventory |
| Stock transfers | `/commerce/transfers` | Inventory |
| Replenishment | `/commerce/replenishment` | Inventory |
| Adjustments & audit | `/commerce/adjustments` | Inventory |
| Suppliers | `/commerce/suppliers` | Inventory |
| Customers | `/commerce/customers` | Customers |
| Customer segments | `/commerce/segments` | Customers |
| Checkout experience | `/commerce/checkout` | Checkout & pricing |
| Checkout payment methods | `/commerce/methods` | Checkout & pricing |
| Coupons | `/commerce/coupons` | Checkout & pricing |
| Automatic discounts | `/commerce/discounts` | Checkout & pricing |
| Promotions | `/commerce/promotions` | Checkout & pricing |
| Gift cards | `/commerce/gift-cards` | Checkout & pricing |
| Campaigns | `/commerce/campaigns` | Checkout & pricing |
| Marketplace overview | `/commerce/marketplace` | Marketplace |
| Vendors | `/commerce/vendors` | Marketplace |
| Vendor applications | `/commerce/applications` | Marketplace |
| Product approvals | `/commerce/approvals` | Marketplace |
| Vendor orders | `/commerce/vendor-orders` | Marketplace |
| Commission rules | `/commerce/commissions` | Marketplace |
| Vendor payouts | `/commerce/payouts` | Marketplace |
| Marketplace disputes | `/commerce/disputes` | Marketplace |
| Marketplace policy | `/commerce/settings-marketplace` | Marketplace |
| Online store | `/commerce/store` | Online store |
| Menus & mega menus | `/commerce/menus` | Online store |
| Store pages | `/commerce/pages` | Online store |
| Blog posts | `/commerce/blog` | Online store |
| Testimonials | `/commerce/testimonials` | Online store |
| Contact messages | `/commerce/contacts` | Online store |
| Popups & announcements | `/commerce/popups` | Online store |
| FAQ library | `/commerce/faqs` | Online store |
| Transactions | `/commerce/transactions` | Payments |
| Payment providers | `/commerce/providers` | Payments |
| Settlements | `/commerce/settlements` | Payments |
| Payment links | `/commerce/payment-links` | Payments |
| Sales report | `/commerce/report-sales` | Reports |
| Orders report | `/commerce/report-orders` | Reports |
| Products report | `/commerce/report-products` | Reports |
| Inventory report | `/commerce/report-inventory` | Reports |
| Customers report | `/commerce/report-customers` | Reports |
| Returns report | `/commerce/report-returns` | Reports |
| Channels report | `/commerce/report-channels` | Reports |
| Payments report | `/commerce/report-payments` | Reports |
| Vendors report | `/commerce/report-vendors` | Reports |
| Marketing report | `/commerce/report-marketing` | Reports |
| Customer inbox | `/commerce/chat` | Communication |
| Support tickets | `/commerce/tickets` | Communication |
| Email workspace | `/commerce/email` | Communication |
| Message templates | `/commerce/email-templates` | Communication |
| Notifications & activity | `/commerce/notifications` | Communication |
| AI workflows | `/commerce/ai-workflows` | Veylix AI |
| Commerce AI studio | `/commerce/ai-studio` | Veylix AI |
| Voice & product assist | `/commerce/ai-voice` | Veylix AI |
| AI knowledge | `/commerce/knowledge` | Veylix AI |
| Prompt library | `/commerce/prompts` | Veylix AI |
| AI reply rules | `/commerce/automations` | Veylix AI |
| AI activity & usage | `/commerce/ai-history` | Veylix AI |
| Media library | `/commerce/media` | Media & files |
| File manager | `/commerce/files` | Media & files |
| Team members | `/commerce/users` | Team & access |
| Roles | `/commerce/roles` | Team & access |
| Permission matrix | `/commerce/permissions` | Team & access |
| Teams | `/commerce/teams` | Team & access |
| Activity log | `/commerce/audit` | Team & access |
| API connections | `/commerce/integrations` | Integrations |
| Webhooks | `/commerce/webhooks` | Integrations |
| General settings | `/commerce/settings-general` | Settings |
| Branding | `/commerce/settings-branding` | Settings |
| Language & currency | `/commerce/settings-localization` | Settings |
| Store SEO | `/commerce/settings-seo` | Settings |
| Maintenance mode | `/commerce/settings-maintenance` | Settings |
| Marketing connections | `/commerce/settings-marketing` | Settings |
| Tax rules | `/commerce/taxes` | Settings |
| Shipping zones & rates | `/commerce/shipping-rules` | Settings |
| Notification preferences | `/commerce/settings-notifications` | Settings |
| Email delivery | `/commerce/settings-email` | Settings |
| Storage settings | `/commerce/settings-storage` | Settings |
| Security | `/commerce/settings-security` | Settings |
| My profile | `/commerce/profile` | Workspace |
| Add product | `/commerce/products/new` | Products |
| Edit product | `/commerce/products/edit` | Products |

### Legacy short URLs (redirects in `next.config.ts`)

`/` redirects to `/overview`.

| From | To |
| --- | --- |
| `/products` | `/commerce/products` |
| `/orders` | `/commerce/orders` |
| `/inventory` | `/commerce/stock` |
| `/shipping` | `/commerce/fulfillment` |
| `/fulfillment` | `/commerce/fulfillment` |
| `/customers` | `/commerce/customers` |
| `/store-channels` | `/commerce/store` |
| `/marketplace` | `/commerce/marketplace` |
| `/pricing` | `/commerce/checkout` |
| `/promotions` | `/commerce/promotions` |
| `/analytics` | `/commerce/report-sales` |
| `/marketing` | `/commerce/campaigns` |
| `/ai-assistant` | `/commerce/ai-studio` |
| `/finances` | `/commerce/transactions` |

## Page components

`src/components/layout/route-content.tsx` maps each route to the component that renders it, exactly as the original router did. Routes that don't appear below go to one of these:

- `ResourceModulePage` (`src/features/resources`): generic config-driven pages, such as carriers, coupons and users.
- `ReportPage`: `report-*`.
- `SettingsPage`: `settings-*`, `taxes` and `shipping-rules`.

| Component | File |
| --- | --- |
| `PermissionsPage` | `src/features/access/components/permissions-page.tsx` |
| `AiStudioPage` | `src/features/ai/components/ai-studio-page.tsx` |
| `AiWorkflowsPage` | `src/features/ai/components/ai-workflows-page.tsx` |
| `CheckoutPage` | `src/features/checkout/components/checkout-page.tsx` |
| `ChatPage` | `src/features/communication/components/chat-page.tsx` |
| `CustomersPage` | `src/features/customers/components/customers-page.tsx` |
| `SegmentsPage` | `src/features/customers/components/segments-page.tsx` |
| `IntegrationsPage` | `src/features/integrations/components/integrations-page.tsx` |
| `StockPage` | `src/features/inventory/components/stock-page.tsx` |
| `CommissionsPage` | `src/features/marketplace/components/commissions-page.tsx` |
| `DisputesPage` | `src/features/marketplace/components/disputes-page.tsx` |
| `ListingApprovalsPage` | `src/features/marketplace/components/listing-approvals-page.tsx` |
| `MarketplaceOverviewPage` | `src/features/marketplace/components/marketplace-overview-page.tsx` |
| `MarketplaceSettingsPage` | `src/features/marketplace/components/marketplace-settings-page.tsx` |
| `VendorApplicationsPage` | `src/features/marketplace/components/vendor-applications-page.tsx` |
| `VendorOrdersPage` | `src/features/marketplace/components/vendor-orders-page.tsx` |
| `VendorPayoutsPage` | `src/features/marketplace/components/vendor-payouts-page.tsx` |
| `VendorsPage` | `src/features/marketplace/components/vendors-page.tsx` |
| `MediaLibraryPage` | `src/features/media/components/media-library-page.tsx` |
| `MenusPage` | `src/features/online-store/components/menus-page.tsx` |
| `OnlineStorePage` | `src/features/online-store/components/online-store-page.tsx` |
| `DeliveriesPage` | `src/features/orders/components/deliveries-page.tsx` |
| `FulfillmentPage` | `src/features/orders/components/fulfillment-page.tsx` |
| `OrderOperationsPage` | `src/features/orders/components/order-operations-page.tsx` |
| `OrdersPage` | `src/features/orders/components/orders-page.tsx` |
| `OverviewPage` | `src/features/overview/components/overview-page.tsx` |
| `PaymentLinksPage` | `src/features/payments/components/payment-links-page.tsx` |
| `SettlementsPage` | `src/features/payments/components/settlements-page.tsx` |
| `TransactionsPage` | `src/features/payments/components/transactions-page.tsx` |
| `AttributesPage` | `src/features/products/components/attributes-page.tsx` |
| `BrandsPage` | `src/features/products/components/brands-page.tsx` |
| `CategoriesPage` | `src/features/products/components/categories-page.tsx` |
| `CollectionsPage` | `src/features/products/components/collections-page.tsx` |
| `ProductsPage` | `src/features/products/components/products-page.tsx` |
| `ReviewsPage` | `src/features/products/components/reviews-page.tsx` |
| `TagsPage` | `src/features/products/components/tags-page.tsx` |
| `VariantsPage` | `src/features/products/components/variants-page.tsx` |
| `ProductEditorPage` | `src/features/products/editor/product-editor-page.tsx` |
| `ProfilePage` | `src/features/profile/components/profile-page.tsx` |
| `ReportPage` | `src/features/reports/components/report-page.tsx` |
| `ResourceModulePage` | `src/features/resources/resource-module-page.tsx` |
| `SettingsPage` | `src/features/settings/components/settings-page.tsx` |

## Shared templates

- **Shell:** `components/layout/app-shell.tsx` (sidebar, topbar, overlay host, toast host), `sidebar.tsx`, `topbar.tsx`, `global-search-dialog.tsx`, `notifications-menu.tsx`, `language-menu.tsx`, `period-menu.tsx` and `profile-menu.tsx`.
- **Generic module pages:** module definitions in `src/config/modules/*.ts`, built with the field builders in `src/config/modules/fields.ts` and rendered by `ResourceModulePage` together with `resource-record-dialog.tsx`.
- **UI primitives:** `src/components/ui` (app dialog, commerce heading, form field, image field, pagination, status pills and summary cards).
- **Charts:** Chart.js 4.5.1. Components are registered in `src/components/charts/chart-setup.ts`, and the custom HTML tooltip is in `src/components/charts`. The overview charts, map and keyboard handling are attached in `src/features/overview/lib`.

## Data

- **Sample data:** dashboard datasets in `src/data`, and seed records for every module in `src/config/modules`.
- **Commerce store:** `src/lib/store/*`. It keeps records in `localStorage` (key prefix `veylix:`). Uploaded media goes to IndexedDB (`src/lib/media-storage.ts`).
- **Browser events:** `veylix:toast`, `veylix:dialog-close`, `veylix:navigate`, `veylix:period`, `veylix:locale`, `veylix:profile`, `veylix:branding` and `veylix:commerce`.

## i18n

`src/i18n` holds the locales (en, de, fr, sv, ar), the translation dictionary and `translateDom`. Like the original, `translateDom` translates rendered text inside `#app`. Arabic sets `dir="rtl"`, and the RTL styles are in `src/styles/layout/rtl.css`.

## Source tree

| Folder | Files |
| --- | --- |
| `src/app` | 1 |
| `src/app/(dashboard)` | 1 |
| `src/app/(dashboard)/[...unknownPath]` | 1 |
| `src/app/(dashboard)/commerce/[moduleId]` | 1 |
| `src/app/(dashboard)/commerce/products` | 1 |
| `src/app/(dashboard)/commerce/products/[editorMode]` | 1 |
| `src/app/(dashboard)/overview` | 1 |
| `src/components/charts` | 3 |
| `src/components/icons` | 2 |
| `src/components/layout` | 19 |
| `src/components/ui` | 11 |
| `src/config` | 7 |
| `src/config/modules` | 8 |
| `src/data` | 2 |
| `src/features/access` | 1 |
| `src/features/access/components` | 1 |
| `src/features/access/lib` | 1 |
| `src/features/ai` | 2 |
| `src/features/ai/components` | 4 |
| `src/features/checkout` | 1 |
| `src/features/checkout/components` | 4 |
| `src/features/checkout/lib` | 2 |
| `src/features/communication` | 1 |
| `src/features/communication/components` | 1 |
| `src/features/customers/components` | 7 |
| `src/features/customers/lib` | 2 |
| `src/features/integrations` | 1 |
| `src/features/integrations/components` | 5 |
| `src/features/inventory/components` | 4 |
| `src/features/inventory/lib` | 1 |
| `src/features/marketplace/components` | 35 |
| `src/features/marketplace/data` | 2 |
| `src/features/marketplace/lib` | 14 |
| `src/features/media` | 1 |
| `src/features/media/components` | 3 |
| `src/features/online-store` | 1 |
| `src/features/online-store/components` | 6 |
| `src/features/online-store/lib` | 1 |
| `src/features/orders/components` | 22 |
| `src/features/orders/constants` | 2 |
| `src/features/orders/lib` | 3 |
| `src/features/overview/components` | 18 |
| `src/features/overview/data` | 1 |
| `src/features/overview/lib` | 4 |
| `src/features/payments` | 1 |
| `src/features/payments/components` | 11 |
| `src/features/payments/lib` | 1 |
| `src/features/products/components` | 22 |
| `src/features/products/editor` | 2 |
| `src/features/products/editor/components` | 17 |
| `src/features/products/editor/lib` | 2 |
| `src/features/products/lib` | 4 |
| `src/features/profile` | 1 |
| `src/features/profile/components` | 1 |
| `src/features/reports` | 1 |
| `src/features/reports/components` | 1 |
| `src/features/reports/lib` | 1 |
| `src/features/resources` | 1 |
| `src/features/resources/components` | 5 |
| `src/features/settings` | 1 |
| `src/features/settings/components` | 2 |
| `src/i18n` | 3 |
| `src/lib` | 13 |
| `src/lib/export` | 1 |
| `src/lib/store` | 7 |
| `src/styles` | 1 |
| `src/styles/base` | 4 |
| `src/styles/components` | 4 |
| `src/styles/features` | 23 |
| `src/styles/layout` | 3 |
