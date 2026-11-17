import type { Metadata } from "next";
import { RouteView } from "@/components/layout/route-view";

export const metadata: Metadata = { title: "Page not found" };

/** Any other address renders the in-shell "Page not found" card, as in the original. */
export default function UnknownRoute() {
  return <RouteView />;
}
