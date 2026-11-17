// @ts-nocheck
import { ChartFrame } from "@/components/charts/chart-frame";
import { CardHeading } from "@/components/ui/card-primitives";
import { paymentMethodShare } from "@/data/dashboard";

function formatCompactAmount(e) {
  if (e >= 1e6) return `${(e / 1e6).toFixed(e >= 1e7 ? 0 : 1)}M`;
  const t = e / 1e3;
  return t >= 100 ? `${Math.round(t)}K` : `${t.toFixed(1)}K`;
}

export function PaymentMethodsCard({ period }) {
  return (
    <section className="glass-card payment-card">
      <CardHeading title="Payment Methods" action="payments" />
      <div className="donut-layout">
        <ChartFrame
          id="payments"
          label="Sales by payment method"
          className="donut-frame"
          center={
            <div className="donut-center">
              <strong>{formatCompactAmount(period.sales)}</strong>
              <span>Total sales</span>
            </div>
          }
        />
        <div className="donut-legend payment-legend">
          {paymentMethodShare.map((e, t) => (
            <button
              key={e.name}
              type="button"
              data-chart-segment="payments"
              data-index={t}
              aria-label={`Inspect ${e.name}: ${e.percent}%`}
            >
              <i
                className="legend-square"
                style={{
                  background: e.color,
                }}
              />
              <span>{e.name}</span>
              <strong>{e.percent}%</strong>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
