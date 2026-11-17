// @ts-nocheck
import { ChartFrame } from "@/components/charts/chart-frame";
import { CardHeading } from "@/components/ui/card-primitives";
import { inventorySummary } from "@/data/dashboard";
import { inventoryStockSegments } from "@/features/overview/data/inventory-charts";
import { formatNumber } from "@/lib/format";

export function InventoryStatusCard() {
  const e = Math.round((inventorySummary.inStock / inventorySummary.total) * 100);
  return (
    <section className="glass-card inventory-card">
      <CardHeading title="Inventory Status" action="inventory" />
      <div className="donut-layout">
        <ChartFrame
          id="inventory"
          label="Inventory by stock status"
          className="donut-frame"
          center={
            <div className="donut-center">
              <strong>{e}%</strong>
              <span>In stock</span>
            </div>
          }
        />
        <div className="donut-legend">
          {inventoryStockSegments.map((e, t) => (
            <button
              key={e.name}
              type="button"
              data-chart-segment="inventory"
              data-index={t}
              aria-label={`Inspect ${e.name}: ${formatNumber(e.value)} products`}
            >
              <i
                className="legend-square"
                style={{
                  background: e.color,
                }}
              />
              <span>{e.name}</span>
              <strong>{formatNumber(e.value)}</strong>
            </button>
          ))}
          <p>
            {"Total Products "}
            <b>{formatNumber(inventorySummary.total)}</b>
          </p>
        </div>
      </div>
    </section>
  );
}
