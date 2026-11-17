// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { CardHeading, ToneBadge } from "@/components/ui/card-primitives";
import { recentShipmentUpdates } from "@/data/dashboard";

export function LiveShipmentsCard() {
  const e = recentShipmentUpdates.filter((e) => e.status !== "Package created");
  return (
    <section className="glass-card shipments-card">
      <CardHeading title="Live Shipments" action="shipments" />
      <div className="shipment-list">
        {e.map((e) => (
          <button
            key={e.id}
            type="button"
            className="shipment-row"
            data-action="shipment"
            data-id={e.id}
          >
            <Icon name="package" />
            <span>#{e.id}</span>
            <ToneBadge label={e.status} tone={e.tone} />
            <small>{e.time}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
