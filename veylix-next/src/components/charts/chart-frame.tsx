// @ts-nocheck

export function ChartFrame({ id, label, className, center = null }) {
  return (
    <div className={`chart-frame ${className}`}>
      <canvas
        data-chart={id}
        tabIndex={0}
        role="img"
        aria-label={label}
        aria-describedby={`${id}-help`}
      />
      {center}
      <span className="sr-only" id={`${id}-help`}>
        Hover or tap to inspect values. With the chart focused, use left and
        right arrows to explore data, and Escape to dismiss.
      </span>
      <div
        className="chart-tooltip"
        role="tooltip"
        id={`${id}-tooltip`}
        aria-live="polite"
      />
    </div>
  );
}
