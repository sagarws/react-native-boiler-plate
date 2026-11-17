// @ts-nocheck
import { CardHeading } from "@/components/ui/card-primitives";
import { topProducts } from "@/data/dashboard";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { formatCurrency, formatNumber } from "@/lib/format";

export function TopProductsCard() {
  return (
    <section className="glass-card top-products-card">
      <CardHeading title="Top Products" action="products" />
      <div className="product-list">
        {topProducts.map((e, t) => (
          <button
            key={e.id}
            type="button"
            className="product-row"
            data-action="product"
            data-id={e.id}
          >
            <span className={`rank rank-${t}`}>{t + 1}</span>
            <OverviewProductThumb product={e} />
            <span className="product-copy">
              <strong>{e.name}</strong>
              <small>
                {formatNumber(e.sold)}
                {" sold"}
              </small>
            </span>
            <b>{formatCurrency(e.price, 2)}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
