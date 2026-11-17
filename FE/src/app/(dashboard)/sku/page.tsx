import type { Metadata } from "next";
import { SkuPage } from "@/features/sku/sku-page";

export const metadata: Metadata = { title: "SKU Data" };

export default function Page() {
  return <SkuPage />;
}
