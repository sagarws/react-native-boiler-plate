// @ts-nocheck
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import {
  isKnownPageRoute,
  isReportRoute,
  isResourceModuleRoute,
  isSettingsRoute,
} from "@/config/route-groups";
import { PermissionsPage } from "@/features/access/components/permissions-page";
import { AiStudioPage } from "@/features/ai/components/ai-studio-page";
import { AiWorkflowsPage } from "@/features/ai/components/ai-workflows-page";
import { CheckoutPage } from "@/features/checkout/components/checkout-page";
import { ChatPage } from "@/features/communication/components/chat-page";
import { CustomersPage } from "@/features/customers/components/customers-page";
import { SegmentsPage } from "@/features/customers/components/segments-page";
import { IntegrationsPage } from "@/features/integrations/components/integrations-page";
import { StockPage } from "@/features/inventory/components/stock-page";
import { CommissionsPage } from "@/features/marketplace/components/commissions-page";
import { DisputesPage } from "@/features/marketplace/components/disputes-page";
import { ListingApprovalsPage } from "@/features/marketplace/components/listing-approvals-page";
import { MarketplaceOverviewPage } from "@/features/marketplace/components/marketplace-overview-page";
import { MarketplaceSettingsPage } from "@/features/marketplace/components/marketplace-settings-page";
import { VendorApplicationsPage } from "@/features/marketplace/components/vendor-applications-page";
import { VendorOrdersPage } from "@/features/marketplace/components/vendor-orders-page";
import { VendorPayoutsPage } from "@/features/marketplace/components/vendor-payouts-page";
import { VendorsPage } from "@/features/marketplace/components/vendors-page";
import { MediaLibraryPage } from "@/features/media/components/media-library-page";
import { MenusPage } from "@/features/online-store/components/menus-page";
import { OnlineStorePage } from "@/features/online-store/components/online-store-page";
import { DeliveriesPage } from "@/features/orders/components/deliveries-page";
import { FulfillmentPage } from "@/features/orders/components/fulfillment-page";
import { OrderOperationsPage } from "@/features/orders/components/order-operations-page";
import { OrdersPage } from "@/features/orders/components/orders-page";
import { OverviewPage } from "@/features/overview/components/overview-page";
import { mountOverviewInteractions } from "@/features/overview/lib/overview-interactions";
import { PaymentLinksPage } from "@/features/payments/components/payment-links-page";
import { SettlementsPage } from "@/features/payments/components/settlements-page";
import { TransactionsPage } from "@/features/payments/components/transactions-page";
import { AttributesPage } from "@/features/products/components/attributes-page";
import { BrandsPage } from "@/features/products/components/brands-page";
import { CategoriesPage } from "@/features/products/components/categories-page";
import { CollectionsPage } from "@/features/products/components/collections-page";
import { ProductsPage } from "@/features/products/components/products-page";
import { ReviewsPage } from "@/features/products/components/reviews-page";
import { TagsPage } from "@/features/products/components/tags-page";
import { VariantsPage } from "@/features/products/components/variants-page";
import { ProductEditorPage } from "@/features/products/editor/product-editor-page";
import { ProfilePage } from "@/features/profile/components/profile-page";
import { ReportPage } from "@/features/reports/components/report-page";
import { ResourceModulePage } from "@/features/resources/resource-module-page";
import { SettingsPage } from "@/features/settings/components/settings-page";
import { applyDocumentBranding } from "@/lib/branding";
import { closeDialogs } from "@/lib/events";
import { buildHref } from "@/lib/navigation";

function closeMobileNav() {
  document.querySelector(".app-shell")?.classList.remove("mobile-nav-open");
  document
    .querySelector(".mobile-menu")
    ?.setAttribute("aria-expanded", "false");
}

export function RouteContent({ route, path, params, period }) {
  const i = useRef(null);
  const a = params?.toString() || "";
  const o = path === "/overview";
  const s = route?.id === "products";
  const c = route?.id === "variants";
  const u = route?.id === "categories";
  const d = route?.id === "brands";
  const f = route?.id === "collections";
  const p = route?.id === "tags";
  const m = route?.id === "reviews";
  const h = route?.id === "orders";
  const g = route?.id === "stock";
  const _ = route?.id === "customers";
  const v = route?.id === "segments";
  const y = route?.id === "transactions";
  const b = route?.id === "settlements";
  const x = route?.id === "payment-links";
  const S = route?.id === "fulfillment";
  const C = route?.id === "deliveries";
  const w =
    route?.id === "refunds" ||
    route?.id === "cancellations" ||
    route?.id === "abandoned";
  const T = route?.id === "profile";
  const E = route?.editor === "product";
  const D = route?.id === "attributes";
  const O = route?.id === "checkout";
  const k = route?.id === "marketplace";
  const A = route?.id === "vendors";
  const j = route?.id === "applications";
  const M = route?.id === "approvals";
  const N = route?.id === "commissions";
  const ee = route?.id === "vendor-orders";
  const te = route?.id === "payouts";
  const ne = route?.id === "disputes";
  const re = route?.id === "settings-marketplace";
  const ie = route?.id === "store";
  const ae = route?.id === "menus";
  const oe = isReportRoute(route?.id);
  const se = route?.id === "chat";
  const ce = route?.id === "ai-workflows";
  const le = route?.id === "ai-studio";
  const ue = route?.id === "ai-voice";
  const de = route?.id === "media" || route?.id === "files";
  const fe = route?.id === "permissions";
  const pe = route?.id === "integrations" || route?.id === "providers";
  const me = isSettingsRoute(route?.id);
  const he = isResourceModuleRoute(route?.id);
  const ge = o || E || isKnownPageRoute(route?.id);
  const _e = `${path}?${a}${o ? `#period-${period.id}` : ""}`;
  useLayoutEffect(() => {
    const t = i.current;
    if (!t) return;
    let n = () => {};
    closeDialogs();
    closeMobileNav();
    applyDocumentBranding(route?.label || (o ? "Overview" : "Page not found"));
    if (o) {
      n = mountOverviewInteractions(t, period);
    }
    window.scrollTo({
      top: 0,
      behavior: "instant",
    });
    return () => {
      n();
    };
  }, [_e, route?.label, o, period]);
  return (
    <main key={_e} id="main-content" tabIndex={-1} ref={i}>
      {o ? (
        <OverviewPage period={period} />
      ) : s ? (
        <ProductsPage initialQuery={params.get("q") || ""} />
      ) : c ? (
        <VariantsPage initialQuery={params.get("q") || ""} />
      ) : u ? (
        <CategoriesPage />
      ) : d ? (
        <BrandsPage initialQuery={params.get("q") || ""} />
      ) : f ? (
        <CollectionsPage initialQuery={params.get("q") || ""} />
      ) : p ? (
        <TagsPage initialQuery={params.get("q") || ""} />
      ) : m ? (
        <ReviewsPage initialQuery={params.get("q") || ""} />
      ) : h ? (
        <OrdersPage initialQuery={params.get("q") || ""} />
      ) : g ? (
        <StockPage initialQuery={params.get("q") || ""} />
      ) : _ ? (
        <CustomersPage initialQuery={params.get("q") || ""} />
      ) : v ? (
        <SegmentsPage initialQuery={params.get("q") || ""} />
      ) : y ? (
        <TransactionsPage initialQuery={params.get("q") || ""} />
      ) : b ? (
        <SettlementsPage initialQuery={params.get("q") || ""} />
      ) : x ? (
        <PaymentLinksPage initialQuery={params.get("q") || ""} />
      ) : S ? (
        <FulfillmentPage initialQuery={params.get("q") || ""} />
      ) : C ? (
        <DeliveriesPage initialQuery={params.get("q") || ""} />
      ) : w && route?.id ? (
        <OrderOperationsPage
          moduleId={route.id}
          initialQuery={params.get("q") || ""}
        />
      ) : T ? (
        <ProfilePage />
      ) : E ? (
        <ProductEditorPage productId={params.get("id")} />
      ) : D ? (
        <AttributesPage />
      ) : O ? (
        <CheckoutPage />
      ) : k ? (
        <MarketplaceOverviewPage />
      ) : A ? (
        <VendorsPage initialQuery={params.get("q") || ""} />
      ) : j ? (
        <VendorApplicationsPage initialQuery={params.get("q") || ""} />
      ) : M ? (
        <ListingApprovalsPage initialQuery={params.get("q") || ""} />
      ) : N ? (
        <CommissionsPage initialQuery={params.get("q") || ""} />
      ) : ee ? (
        <VendorOrdersPage initialQuery={params.get("q") || ""} />
      ) : te ? (
        <VendorPayoutsPage initialQuery={params.get("q") || ""} />
      ) : ne ? (
        <DisputesPage initialQuery={params.get("q") || ""} />
      ) : re ? (
        <MarketplaceSettingsPage />
      ) : ie ? (
        <OnlineStorePage />
      ) : ae ? (
        <MenusPage />
      ) : oe && route?.id ? (
        <ReportPage moduleId={route.id} />
      ) : se ? (
        <ChatPage initialCustomerId={params.get("customer") || ""} />
      ) : ce ? (
        <AiWorkflowsPage />
      ) : le ? (
        <AiStudioPage params={params} />
      ) : ue ? (
        <AiStudioPage params={params} voice />
      ) : de && (route?.id === "media" || route?.id === "files") ? (
        <MediaLibraryPage moduleId={route.id} />
      ) : fe ? (
        <PermissionsPage />
      ) : pe && (route?.id === "integrations" || route?.id === "providers") ? (
        <IntegrationsPage moduleId={route.id} />
      ) : me && route?.id ? (
        <SettingsPage moduleId={route.id} />
      ) : he && route?.id ? (
        <ResourceModulePage
          moduleId={route.id}
          initialQuery={params.get("q") || ""}
        />
      ) : ge ? null : (
        <section className="glass-card c-empty">
          <h1>Page not found</h1>
          <p>This address does not match a Veylix page.</p>
          <Link className="primary-button" href={buildHref("/overview")}>
            Back to overview
          </Link>
        </section>
      )}
    </main>
  );
}
