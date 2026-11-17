// @ts-nocheck
import {
  CardHeading,
  IconTile,
  ProgressBar,
} from "@/components/ui/card-primitives";
import { salesChannels } from "@/data/dashboard";
import { formatCurrency } from "@/lib/format";

export function SalesChannelsCard({ period }) {
  return (
    <section className="glass-card channels-card">
      <CardHeading title="Sales Channels" action="channels" />
      <div className="channels-list">
        {salesChannels.map((t) => (
          <div key={t.name} className="channel-row">
            <IconTile name={t.icon} tone={t.tone} />
            <span>{t.name}</span>
            <strong>{t.percent}%</strong>
            <ProgressBar value={t.percent} />
            <small>
              {formatCurrency(Math.round((period.sales * t.percent) / 100))}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}
