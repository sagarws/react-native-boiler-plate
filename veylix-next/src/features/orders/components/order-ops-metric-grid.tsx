// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { orderOpsNumberFormatter } from "@/features/orders/constants/order-operations";
import { formatCurrency } from "@/lib/format";

function OrderOpsMetric({ label, value, detail, tone = "mint", icon }) {
  return (
    <div className={`ops-metric ${tone}`}>
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </div>
  );
}

export function OrderOpsMetricGrid({ moduleId, rows }) {
  if (moduleId === "refunds") {
    const e = rows.filter((e) =>
      ["Requested", "Under review"].includes(String(e.status || "")),
    );
    const n = rows.filter((e) =>
      ["Approved for processing", "Processing"].includes(
        String(e.status || ""),
      ),
    );
    const r = rows.filter((e) => e.status === "Completed");
    return (
      <section className="ops-metric-grid" aria-label="Refund overview">
        <OrderOpsMetric
          label="Open refund value"
          value={formatCurrency(
            e.reduce((e, t) => e + Number(t.amount || 0), 0),
            2,
          )}
          detail={`${e.length} awaiting decision`}
          tone="amber"
          icon="arrow-left"
        />
        <OrderOpsMetric
          label="Processing"
          value={formatCurrency(
            n.reduce((e, t) => e + Number(t.amount || 0), 0),
            2,
          )}
          detail={`${n.length} approved or processing`}
          tone="blue"
          icon="timer"
        />
        <OrderOpsMetric
          label="Completed"
          value={formatCurrency(
            r.reduce((e, t) => e + Number(t.amount || 0), 0),
            2,
          )}
          detail={`${r.length} completed requests`}
          icon="check-circle"
        />
        <OrderOpsMetric
          label="Liability review"
          value={orderOpsNumberFormatter.format(
            rows.filter((e) => e.liability === "Under review").length,
          )}
          detail="Cases without a final owner"
          tone="peach"
          icon="info"
        />
      </section>
    );
  }
  if (moduleId === "cancellations")
    return (
      <section className="ops-metric-grid">
        <OrderOpsMetric
          label="Waiting decision"
          value={orderOpsNumberFormatter.format(
            rows.filter((e) =>
              ["Requested", "Under review"].includes(String(e.status || "")),
            ).length,
          )}
          detail="Open cancellation requests"
          tone="amber"
          icon="timer"
        />
        <OrderOpsMetric
          label="Refund required"
          value={orderOpsNumberFormatter.format(
            rows.filter((e) => e.refundAction === "Refund required").length,
          )}
          detail="Payment follow-up needed"
          tone="peach"
          icon="wallet"
        />
        <OrderOpsMetric
          label="Release stock"
          value={orderOpsNumberFormatter.format(
            rows.filter((e) =>
              /release|restock/i.test(String(e.inventoryAction || "")),
            ).length,
          )}
          detail="Inventory actions attached"
          tone="blue"
          icon="package"
        />
        <OrderOpsMetric
          label="Approved"
          value={orderOpsNumberFormatter.format(
            rows.filter((e) => e.status === "Approved").length,
          )}
          detail="Decision history preserved"
          icon="check-circle"
        />
      </section>
    );
  const n = rows.filter((e) =>
    ["Open", "In recovery"].includes(String(e.status || "")),
  );
  const r = rows.filter((e) => e.status === "Recovered");
  const i = rows.length ? Math.round((r.length / rows.length) * 100) : 0;
  return (
    <section className="ops-metric-grid">
      <OrderOpsMetric
        label="Recoverable value"
        value={formatCurrency(
          n.reduce((e, t) => e + Number(t.value || 0), 0),
          2,
        )}
        detail={`${n.length} open baskets`}
        tone="amber"
        icon="cart"
      />
      <OrderOpsMetric
        label="In recovery"
        value={orderOpsNumberFormatter.format(
          rows.filter((e) => e.status === "In recovery").length,
        )}
        detail="Active outreach sequences"
        tone="blue"
        icon="paper-plane"
      />
      <OrderOpsMetric
        label="Recovered value"
        value={formatCurrency(
          r.reduce((e, t) => e + Number(t.value || 0), 0),
          2,
        )}
        detail={`${r.length} converted checkouts`}
        icon="check-circle"
      />
      <OrderOpsMetric
        label="Recovery rate"
        value={`${i}%`}
        detail="Demo recovery outcomes"
        tone="peach"
        icon="chart-line-up"
      />
    </section>
  );
}
