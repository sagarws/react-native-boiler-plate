import type { Metadata } from "next";
import { RouteView } from "@/components/layout/route-view";
import { routeTitle } from "@/config/route-manifest";

/** Product editor: `/commerce/products/new` and `/commerce/products/edit?id=…`. */
export function generateStaticParams() {
  return [{ editorMode: "new" }, { editorMode: "edit" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/commerce/products/[editorMode]">): Promise<Metadata> {
  const { editorMode } = await params;
  return { title: routeTitle(`/commerce/products/${editorMode}`) };
}

export default function ProductEditorRoute() {
  return <RouteView />;
}
