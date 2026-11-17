// @ts-nocheck
import { ChartFrame } from "@/components/charts/chart-frame";
import { Icon } from "@/components/icons/icon";
import { IconTile } from "@/components/ui/card-primitives";
import { formatCurrency, formatNumber } from "@/lib/format";

function SalesSubstat({ value, label }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function SalesSummaryCard({ period }) {
  return (
    <section className="glass-card sales-summary" aria-label="Total sales">
      <div className="sales-label">
        <IconTile name="cart" />
        <h2>
          {"Total Sales "}
          <span>(GMV)</span>
        </h2>
        <span className="sales-live">
          <Icon name="chart-line-up" />
        </span>
      </div>
      <div className="sales-total">
        <strong>{formatCurrency(period.sales)}</strong>
        <ChartFrame
          id="sales"
          label="Sales trend samples in USD"
          className="mini-bars"
        />
      </div>
      <div className="sales-change">
        <span>
          <Icon name="arrow-up" /> {period.change}%
        </span>
        {" vs previous period"}
      </div>
      <div className="sales-substats">
        <SalesSubstat value={formatNumber(period.orders)} label="Orders" />
        <SalesSubstat value={`${period.conversion}%`} label="Conversion" />
        <SalesSubstat
          value={formatCurrency(period.aov, 1)}
          label="Avg. order value"
        />
      </div>
    </section>
  );
}
