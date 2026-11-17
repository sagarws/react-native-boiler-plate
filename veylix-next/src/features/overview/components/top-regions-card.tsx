// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { CardHeading } from "@/components/ui/card-primitives";
import { salesByRegion } from "@/data/dashboard";
import { formatCurrency } from "@/lib/format";

export function TopRegionsCard({ period }) {
  const t = 100 - salesByRegion.reduce((e, t) => e + t.percent, 0);
  const n = salesByRegion[0];
  return (
    <section className="glass-card regions-card">
      <CardHeading title="Top Buying Regions" action="regions" />
      <div className="regions-content">
        <div className="map-frame">
          <div
            className="world-map"
            role="group"
            aria-label="Interactive world map"
            aria-busy="true"
          />
          <div className="chart-tooltip" role="tooltip" id="map-tooltip" />
        </div>
        <div className="region-list">
          {salesByRegion.map((t) => (
            <button
              key={t.code}
              type="button"
              data-region={t.code.toLowerCase()}
              aria-pressed={t.code === "US" ? "true" : "false"}
            >
              <span className={`country-code flag-${t.code.toLowerCase()}`}>
                {t.code}
              </span>
              <span className="region-copy">
                <span>{t.name}</span>
                <small>
                  {formatCurrency((period.sales * t.percent) / 100)}
                </small>
              </span>
              <strong>{t.percent}%</strong>
            </button>
          ))}
          <button type="button" data-action="regions">
            <span className="country-code flag-other">
              <Icon name="globe" />
            </span>
            <span className="region-copy">
              <span>Other regions</span>
              <small>{formatCurrency((period.sales * t) / 100)}</small>
            </span>
            <strong>{t}%</strong>
          </button>
        </div>
        <p className="region-insight" aria-live="polite">
          {n.name}
          {" · "}
          {n.percent}
          {"% · "}
          {formatCurrency((period.sales * n.percent) / 100)}
        </p>
      </div>
    </section>
  );
}
