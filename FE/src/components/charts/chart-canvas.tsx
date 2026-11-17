"use client";

import type { ChartConfiguration, ChartType } from "chart.js";
import { useEffect, useId, useRef } from "react";
import { Chart } from "@/components/charts/chart-setup";
import { renderExternalChartTooltip } from "@/components/charts/chart-tooltip";

/**
 * Template `chart-frame` around a Chart.js canvas. The chart is created on mount, updated when
 * `config` changes, and destroyed on unmount.
 */
export function ChartCanvas<T extends ChartType>({
  config,
  label,
  className = "",
  height = 260,
}: {
  config: ChartConfiguration<T>;
  label: string;
  className?: string;
  height?: number;
}) {
  const id = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<T> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cfg: ChartConfiguration<T> = {
      ...config,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...config.options,
        plugins: {
          ...config.options?.plugins,
          tooltip: { enabled: false, external: renderExternalChartTooltip, ...config.options?.plugins?.tooltip },
        },
      } as ChartConfiguration<T>["options"],
    };
    if (chartRef.current) {
      chartRef.current.data = cfg.data;
      if (cfg.options) chartRef.current.options = cfg.options;
      chartRef.current.update();
    } else {
      chartRef.current = new Chart(canvas, cfg);
    }
  }, [config]);

  useEffect(
    () => () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    },
    [],
  );

  return (
    <div className={`chart-frame ${className}`.trim()} style={{ height, position: "relative" }}>
      <canvas ref={canvasRef} tabIndex={0} role="img" aria-label={label} aria-describedby={`${id}-help`} />
      <span className="sr-only" id={`${id}-help`}>
        Hover or tap to inspect values.
      </span>
      <div className="chart-tooltip" role="tooltip" aria-live="polite" />
    </div>
  );
}
