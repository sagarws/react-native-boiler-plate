// @ts-nocheck
import { IconTile } from "@/components/ui/card-primitives";
import { formatNumber } from "@/lib/format";
import { listRecords } from "@/lib/store/core";

export function HeaderMetrics({ period }) {
  const t = listRecords("products");
  const n = listRecords("deliveries");
  const r = t.filter(
    (e) => Number(e.stock || 0) <= Number(e.threshold ?? 15),
  ).length;
  const i = n.filter((e) => String(e.status || "") === "Delayed").length;
  return (
    <div className="header-metrics">
      <button type="button" className="header-metric" data-action="orders">
        <IconTile name="cart" tone="success" />
        <span>
          Orders
          <strong data-header-orders="">{formatNumber(period.orders)}</strong>
        </span>
      </button>
      <button type="button" className="header-metric" data-action="low-stock">
        <IconTile name="package" />
        <span>
          Low stock<strong>{formatNumber(r)}</strong>
        </span>
      </button>
      <button type="button" className="header-metric" data-action="shipments">
        <IconTile name="truck" tone="danger" />
        <span>
          Delayed<strong>{formatNumber(i)}</strong>
        </span>
      </button>
    </div>
  );
}
