import type { Metadata } from "next";
import { RouteView } from "@/components/layout/route-view";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewRoute() {
  return <RouteView />;
}
