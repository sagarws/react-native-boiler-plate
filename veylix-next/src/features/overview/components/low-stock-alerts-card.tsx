// @ts-nocheck
import { CardHeading } from "@/components/ui/card-primitives";
import { lowStockProducts } from "@/data/dashboard";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { listRecords } from "@/lib/store/core";

const productImageIconMap = {
  tee: "t-shirt",
  backpack: "backpack",
  mug: "coffee",
  tote: "tote",
  mouse: "mouse",
  bottle: "thermometer",
  notebook: "notebook",
};

export function LowStockAlertsCard() {
  const e = listRecords("products");
  const t = e
    .filter(
      (e) =>
        Number(e.stock || 0) > 0 &&
        Number(e.stock || 0) <= Number(e.threshold ?? 15),
    )
    .sort((e, t) => Number(e.stock || 0) - Number(t.stock || 0))
    .slice(0, 4)
    .map((e) => ({
      id: String(e.id || ""),
      name: String(e.name || "Product"),
      count: Number(e.stock || 0),
      icon: productImageIconMap[String(e.image || "")] || String(e.image || ""),
    }));
  const n = lowStockProducts.map((t) => {
    const n = e.find((e) => String(e.name || "") === String(t.name));
    return {
      id: String(n?.id || t.id),
      name: String(t.name),
      count: Number(t.count),
      icon:
        productImageIconMap[String(n?.image || "")] ||
        String(n?.image || t.icon),
    };
  });
  const r = t.length ? t : n;
  return (
    <section className="glass-card low-stock-card">
      <CardHeading title="Low Stock Alerts" action="low-stock" />
      <div className="low-stock-list">
        {r.map((e) => (
          <button
            key={`${e.id}-${e.name}`}
            type="button"
            className="low-stock-row"
            data-action="restock"
            data-id={e.id}
          >
            <OverviewProductThumb
              product={{
                icon: e.icon,
              }}
            />
            <span>{e.name}</span>
            <strong>
              {e.count}
              {" left"}
            </strong>
          </button>
        ))}
      </div>
    </section>
  );
}
