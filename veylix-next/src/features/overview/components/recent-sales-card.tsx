// @ts-nocheck
import { useState } from "react";
import { CardHeading, ToneBadge } from "@/components/ui/card-primitives";
import { recentOrders } from "@/data/dashboard";
import {
  DashboardPagination,
  paginateDashboardRows,
} from "@/features/overview/components/dashboard-pagination";
import { formatCurrency } from "@/lib/format";

export function RecentSalesTable({ rows = recentOrders, compact = false }) {
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Recent sales table"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Order ID</th>
            <th scope="col">Customer</th>
            <th scope="col">Items</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, compact ? 5 : rows.length).map((e) => (
            <tr key={e.id}>
              <td>
                <button
                  type="button"
                  className="table-link"
                  data-action="order"
                  data-id={e.id}
                >
                  #{e.id}
                </button>
              </td>
              <td>{e.customer}</td>
              <td>
                {e.items} {e.items === 1 ? "item" : "items"}
              </td>
              <td>
                <strong>{formatCurrency(e.amount, 2)}</strong>
              </td>
              <td>
                <ToneBadge
                  label={e.status}
                  tone={e.status === "Paid" ? "success" : "amber"}
                />
              </td>
              <td className="muted">{e.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecentSalesCard() {
  const [e, t] = useState(1);
  const [n, r] = useState(false);
  const i = paginateDashboardRows(recentOrders, e);
  return (
    <section className="glass-card recent-sales-card">
      <CardHeading title="Recent Sales" action="orders" />
      <RecentSalesTable rows={i.rows} />
      <DashboardPagination
        kind="sales"
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
