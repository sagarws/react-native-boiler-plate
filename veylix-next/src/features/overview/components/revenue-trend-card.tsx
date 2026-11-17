// @ts-nocheck
import { ChartFrame } from "@/components/charts/chart-frame";
import { CardHeading } from "@/components/ui/card-primitives";

export function RevenueTrendCard({ period }) {
  return (
    <section className="glass-card revenue-card">
      <CardHeading title="Revenue Trend" />
      <div className="chart-legend">
        <button type="button" data-chart-toggle="0" aria-pressed="true">
          <i className="legend-dot amber" />
          This period
        </button>
        <button type="button" data-chart-toggle="1" aria-pressed="true">
          <i className="legend-dot pale" />
          Last period
        </button>
        <button
          type="button"
          className="icon-button chart-detail"
          data-action="revenue"
          aria-label="View revenue data"
        >
          ↗
        </button>
      </div>
      <ChartFrame
        id="revenue"
        label={`Revenue comparison, ${period.label}`}
        className="revenue-plot"
      />
    </section>
  );
}
