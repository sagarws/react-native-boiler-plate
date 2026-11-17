// @ts-nocheck
import { InventoryStatusCard } from "@/features/overview/components/inventory-status-card";
import { LiveShipmentsCard } from "@/features/overview/components/live-shipments-card";
import { LowStockAlertsCard } from "@/features/overview/components/low-stock-alerts-card";
import { OrderFulfillmentCard } from "@/features/overview/components/order-fulfillment-card";
import { PaymentMethodsCard } from "@/features/overview/components/payment-methods-card";
import { QuickActionsCard } from "@/features/overview/components/quick-actions-card";
import { RecentDeliveriesCard } from "@/features/overview/components/recent-deliveries-card";
import { RecentSalesCard } from "@/features/overview/components/recent-sales-card";
import { RevenueTrendCard } from "@/features/overview/components/revenue-trend-card";
import { SalesChannelsCard } from "@/features/overview/components/sales-channels-card";
import { SalesSummaryCard } from "@/features/overview/components/sales-summary-card";
import { StorePulseSection } from "@/features/overview/components/store-pulse-section";
import { TopProductsCard } from "@/features/overview/components/top-products-card";
import { TopRegionsCard } from "@/features/overview/components/top-regions-card";

export function OverviewPage({ period }) {
  return (
    <div className="dashboard-view">
      <h1 className="sr-only">Store overview</h1>
      <div className="overview-grid">
        <div className="revenue-column">
          <SalesSummaryCard period={period} />
          <RevenueTrendCard period={period} />
        </div>
        <StorePulseSection period={period} />
        <div className="operations-column">
          <div className="operations-pair">
            <OrderFulfillmentCard period={period} />
            <LiveShipmentsCard />
          </div>
          <SalesChannelsCard period={period} />
        </div>
      </div>
      <div className="activity-grid">
        <RecentSalesCard />
        <RecentDeliveriesCard />
        <TopRegionsCard period={period} />
      </div>
      <div className="insights-grid">
        <TopProductsCard />
        <InventoryStatusCard />
        <LowStockAlertsCard />
        <PaymentMethodsCard period={period} />
        <QuickActionsCard />
      </div>
    </div>
  );
}
