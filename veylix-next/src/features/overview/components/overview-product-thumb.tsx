// @ts-nocheck
import { assetUrl } from "@/lib/format";

const productSpritePositions = {
  "t-shirt": "0% 0%",
  backpack: "33.333% 0%",
  coffee: "66.667% 0%",
  tote: "100% 0%",
  mouse: "0% 100%",
  thermometer: "33.333% 100%",
  notebook: "66.667% 100%",
};

export function OverviewProductThumb({ product }) {
  return product.mediaId ? (
    <span
      className="product-thumb product-uploaded"
      data-product-image={product.mediaId}
      aria-hidden="true"
    />
  ) : (
    <span
      className="product-thumb product-photo"
      aria-hidden="true"
      style={{
        backgroundImage: `url('${assetUrl("images/products.webp")}')`,
        backgroundPosition:
          productSpritePositions[product.icon || ""] || "0% 0%",
      }}
    />
  );
}
