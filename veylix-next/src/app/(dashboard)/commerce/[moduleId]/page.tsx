import type { Metadata } from "next";
import { RouteView } from "@/components/layout/route-view";
import { commerceModuleIds, routeTitle } from "@/config/route-manifest";

/** Every module page in the navigation config is prerendered at build time. */
export function generateStaticParams() {
  return commerceModuleIds()
    .filter((moduleId) => moduleId !== "products")
    .map((moduleId) => ({ moduleId }));
}

export async function generateMetadata({
  params,
}: PageProps<"/commerce/[moduleId]">): Promise<Metadata> {
  const { moduleId } = await params;
  return { title: routeTitle(`/commerce/${moduleId}`) };
}

/** Unknown module ids still render inside the shell, which shows "Page not found" like the original. */
export default function CommerceModuleRoute() {
  return <RouteView />;
}
