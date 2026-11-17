"use client";

import type { ChartConfiguration } from "chart.js";
import { useMemo, type ReactNode } from "react";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { chartPalette } from "@/components/charts/chart-setup";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import type { CarrierOrderMetrics } from "@/types/dashboard";

const GRID = "rgba(120, 110, 90, 0.12)";

function deliveryDaysConfig(orders: CarrierOrderMetrics[]): ChartConfiguration<"bar"> {
  const [c1] = chartPalette();
  return {
    type: "bar",
    data: {
      labels: orders.map((o) => o._id),
      datasets: [{ label: "Avg Delivery Time", data: orders.map((o) => o.avgTotalTimeDifference ?? 0), backgroundColor: c1, borderRadius: 6, maxBarThickness: 38 }],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw as number} days` } },
      },
      scales: {
        x: { grid: { display: false }, title: { display: true, text: "Courier" } },
        y: { beginAtZero: true, grid: { color: GRID }, title: { display: true, text: "Days" } },
      },
    },
  };
}

function goodBadConfig(orders: CarrierOrderMetrics[]): ChartConfiguration<"bar"> {
  const palette = chartPalette();
  const good = orders.map((o) => o.countGood ?? 0);
  const bad = orders.map((o) => o.countBad ?? 0);
  return {
    type: "bar",
    data: {
      labels: orders.map((o) => o._id),
      datasets: [
        { label: "Good Orders", data: good, backgroundColor: palette[1], borderRadius: 6, maxBarThickness: 26 },
        { label: "Bad Orders", data: bad, backgroundColor: palette[3], borderRadius: 6, maxBarThickness: 26 },
      ],
    },
    options: {
      plugins: {
        legend: { display: true, position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            // Same as TrackVid GOOD_BAD_CHART: count plus share of that courier's returns.
            label: (ctx) => {
              const total = (good[ctx.dataIndex] ?? 0) + (bad[ctx.dataIndex] ?? 0);
              const value = ctx.raw as number;
              const pct = total ? ((value / total) * 100).toFixed(1) : "0";
              return `${ctx.dataset.label}: ${value} (${pct}%)`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, title: { display: true, text: "Courier" } },
        y: { beginAtZero: true, grid: { color: GRID }, title: { display: true, text: "Count" } },
      },
    },
  };
}

function ChartCard({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="glass-card tv-dash-chart">
      <small className="tv-dash-kicker">{kicker}</small>
      <h3 className="tv-section-title">{title}</h3>
      {children}
    </section>
  );
}

/** TrackVid "Carrier benchmarks": courier-wise avg delivery days + good vs bad returns. */
export function CarrierCharts({ orders, loading, error, onRetry }: { orders: CarrierOrderMetrics[]; loading: boolean; error: string | null; onRetry: () => void }) {
  const speed = useMemo(() => deliveryDaysConfig(orders), [orders]);
  const quality = useMemo(() => goodBadConfig(orders), [orders]);

  const body = (chart: ChartConfiguration<"bar">, label: string) => {
    if (loading) return <Skeleton height={320} radius={12} />;
    if (error) return <ErrorState message={error} onRetry={onRetry} />;
    if (orders.length === 0) return <EmptyState icon="truck" title="No courier data" message="No courier activity in the selected period." />;
    return <ChartCanvas config={chart} label={label} height={320} />;
  };

  return (
    <div className="tv-grid-2">
      <ChartCard kicker="Speed" title="Courier-wise Avg Delivery Days">
        {body(speed, "Average delivery days per courier")}
      </ChartCard>
      <ChartCard kicker="Quality" title="Courier-wise Good vs Bad Returns">
        {body(quality, "Good and bad returns per courier")}
      </ChartCard>
    </div>
  );
}
