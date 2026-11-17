// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { summarizeProductOptions } from "@/features/products/lib/variant-options";
import { integerFormatter } from "@/lib/intl-formatters";

function VariantSummaryCard({ icon, label, value, detail, tone = "green" }) {
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

export function VariantSummaryGrid({ rows, products }) {
  const n = rows.filter((e) => String(e.status || "") === "Active");
  const r = new Set(rows.map((e) => String(e.productId || "")));
  const i = n.filter((e) => Number(e.stock || 0) <= 5).length;
  return (
    <section
      className="product-summary-grid catalog-ops-summary"
      aria-label="Variant overview"
    >
      <VariantSummaryCard
        icon="package"
        label="Variant products"
        value={integerFormatter.format(r.size)}
        detail={`${integerFormatter.format(products.length)} products in catalog`}
      />
      <VariantSummaryCard
        icon="tag"
        label="Variant SKUs"
        value={integerFormatter.format(rows.length)}
        detail={`${integerFormatter.format(n.length)} sellable`}
      />
      <VariantSummaryCard
        icon="info"
        label="Low variant stock"
        value={integerFormatter.format(i)}
        detail={i ? "5 units or fewer" : "Variant inventory is healthy"}
        tone="amber"
      />
      <VariantSummaryCard
        icon="check-circle"
        label="Variant units"
        value={integerFormatter.format(
          n.reduce((e, t) => e + Number(t.stock || 0), 0),
        )}
        detail="Across active combinations"
        tone="blue"
      />
    </section>
  );
}

export function ProductOptionHealthCard({ products }) {
  const t = summarizeProductOptions(products);
  return (
    <section className="glass-card catalog-option-health">
      <div className="catalog-ops-heading">
        <div>
          <span>OPTION ARCHITECTURE</span>
          <h2>Reusable product choices</h2>
          <p>
            See which option groups are shaping variants across the catalog
            before opening a product editor.
          </p>
        </div>
        <small>
          {t.length}
          {" option groups detected"}
        </small>
      </div>
      <div className="catalog-option-health-grid">
        {t.length ? (
          t.slice(0, 6).map((t) => (
            <div key={t.name}>
              <span className="catalog-option-icon">
                <Icon name="tag" />
              </span>
              <div>
                <strong>{t.name}</strong>
                <small>
                  {t.products.size}
                  {" product"}
                  {t.products.size === 1 ? "" : "s"}
                  {" · "}
                  {t.values.size}
                  {" values"}
                </small>
              </div>
              <em>
                {products.length
                  ? Math.round((t.products.size / products.length) * 100)
                  : 0}
                %
              </em>
            </div>
          ))
        ) : (
          <p className="catalog-option-empty">
            No product options are configured yet. Open a product and add
            choices such as Color, Size or Finish.
          </p>
        )}
      </div>
    </section>
  );
}
