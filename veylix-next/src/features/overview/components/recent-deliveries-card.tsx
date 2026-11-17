// @ts-nocheck
import { useState } from "react";
import { CardHeading, ToneBadge } from "@/components/ui/card-primitives";
import { activeShipments } from "@/data/dashboard";
import {
  DashboardPagination,
  paginateDashboardRows,
} from "@/features/overview/components/dashboard-pagination";

export function RecentDeliveriesTable({ rows = activeShipments }) {
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Recent deliveries table"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Tracking #</th>
            <th scope="col">Customer</th>
            <th scope="col">Destination</th>
            <th scope="col">Status</th>
            <th scope="col">ETA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.tracking}>
              <td>{e.tracking}</td>
              <td>{e.customer}</td>
              <td>{e.destination}</td>
              <td>
                <ToneBadge label={e.status} tone={e.tone} />
              </td>
              <td className="muted">{e.eta}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecentDeliveriesCard() {
  const [e, t] = useState(1);
  const [n, r] = useState(false);
  const i = paginateDashboardRows(activeShipments, e);
  return (
    <section className="glass-card recent-deliveries-card">
      <CardHeading title="Recent Deliveries" action="deliveries" />
      <RecentDeliveriesTable rows={i.rows} />
      <DashboardPagination
        kind="deliveries"
        current={i.current}
        pages={i.pages}
        from={i.from}
        to={i.to}
        total={i.total}
        focusCurrent={n}
        onPageChange={(e, n = false) => {
          if (!(e < 1 || e > i.pages || e === i.current)) {
            r(n);
            t(e);
          }
        }}
      />
    </section>
  );
}
