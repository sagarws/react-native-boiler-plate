// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { integerFormatter } from "@/lib/intl-formatters";

function ProductSummaryCard({ icon, label, value, detail, tone = "green" }) {
  return (
    <div className={`product-summary-card ${tone}`}>
      <div className="product-summary-top">
        <span className="product-summary-icon">
          <Icon name={icon} />
        </span>
        <small>{detail}</small>
      </div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function ProductSummaryGrid({ rows }) {
  const t = rows.filter(
    (e) => String(e.status || "") === "Active" && Number(e.stock || 0) > 0,
  ).length;
  const n = rows.filter(
    (e) =>
      String(e.status || "") === "Active" &&
      Number(e.stock || 0) > 0 &&
      Number(e.stock || 0) <= Number(e.threshold ?? 15),
  ).length;
  const r = rows.filter(
    (e) => String(e.status || "") === "Active" && Number(e.stock || 0) <= 0,
  ).length;
  const i = (t) =>
    rows.length
      ? `${Math.round((t / rows.length) * 100)}% of catalog`
      : "No catalog data";
  const a = rows.reduce((e, t) => e + Number(t.stock || 0), 0);
  return (
    <section className="product-summary-grid" aria-label="Product overview">
      <ProductSummaryCard
        icon="package"
        label="Total products"
        value={integerFormatter.format(rows.length)}
        detail={`${integerFormatter.format(a)} units available`}
      />
      <ProductSummaryCard
        icon="check-circle"
        label="Active listings"
        value={integerFormatter.format(t)}
        detail={i(t)}
      />
      <ProductSummaryCard
        icon="info"
        label="Low stock"
        value={integerFormatter.format(n)}
        detail={n ? "Needs a restock review" : "Inventory is healthy"}
        tone="amber"
      />
      <ProductSummaryCard
        icon="trash"
        label="Out of stock"
        value={integerFormatter.format(r)}
        detail={r ? "Unavailable to shoppers" : "Nothing unavailable"}
        tone="red"
      />
    </section>
  );
}
