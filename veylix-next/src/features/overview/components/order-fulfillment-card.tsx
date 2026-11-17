// @ts-nocheck
import {
  CardHeading,
  IconTile,
  ProgressBar,
} from "@/components/ui/card-primitives";
import { orderPipelineStages } from "@/data/dashboard";
import { formatNumber } from "@/lib/format";

export function OrderFulfillmentCard({ period }) {
  return (
    <section className="glass-card fulfillment-card">
      <CardHeading title="Order Fulfillment" action="fulfillment" />
      <div className="fulfillment-list">
        {orderPipelineStages.map((t, n) => (
          <div key={t.label} className="fulfillment-row">
            <IconTile name={t.icon} tone={n ? "success" : "amber"} />
            <span>{t.label}</span>
            <ProgressBar value={t.ratio * 100} tone={t.color} />
            <strong>{formatNumber(Math.round(period.orders * t.ratio))}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
