import { daysAgo, seeded } from "@/mocks/delay";
import type { ProductSku } from "@/types/sku";

/** Seller SKU → colour / size / image map (SKU Data screen). Some rows carry a product video instead of an image. */

const COLORS = ["Navy Blue", "Maroon", "Mustard", "Off White", "Olive Green", "Black", "Peach", "Teal"] as const;
const SIZES = ["XS", "S", "M", "L", "XL", "XXL", "Free Size"] as const;
const STYLES = ["UTK-KURTA", "UTD-DRESS", "UTJ-JEANS", "UTS-SAREE", "UTT-TOP", "UTC-COORD", "UTP-PALAZZO"] as const;
const IMAGES = ["/assets/images/products.webp", "/assets/images/warehouse.webp"] as const;
export const SKU_SAMPLE_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

function build(count: number): ProductSku[] {
  const rand = seeded(2207);
  return Array.from({ length: count }, (_, i) => {
    const style = STYLES[i % STYLES.length];
    const color = COLORS[Math.floor(rand() * COLORS.length)];
    const size = SIZES[Math.floor(rand() * SIZES.length)];
    const r = rand();
    const imageLink = r > 0.8 ? SKU_SAMPLE_VIDEO : r > 0.08 ? IMAGES[i % IMAGES.length] : "";
    return {
      _id: `sku${String(i + 1).padStart(21, "0")}`,
      companyId: "64f0c0ffee0000000000c001",
      fileKey: "sku/SKU_Data.xlsx",
      userId: "64f0c0ffee0000000000a001",
      sellerSkuCode: `${style}-${color.split(" ")[0].toUpperCase().slice(0, 3)}-${size.replace(" ", "")}`,
      color: rand() > 0.05 ? color : "",
      size: rand() > 0.05 ? size : "",
      imageLink,
      imageSize: imageLink ? `${(80 + Math.floor(rand() * 900)).toString()} KB` : undefined,
      isDeleted: false,
      createdAt: daysAgo(2 + Math.floor(rand() * 60), 10),
      updatedAt: daysAgo(1, 10),
      __v: 0,
    };
  });
}

export const productSkuSeed: ProductSku[] = build(86);
