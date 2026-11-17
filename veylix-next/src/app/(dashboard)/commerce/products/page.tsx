import type { Metadata } from "next";
import { RouteView } from "@/components/layout/route-view";

export const metadata: Metadata = { title: "Products" };

export default function ProductsRoute() {
  return <RouteView />;
}
