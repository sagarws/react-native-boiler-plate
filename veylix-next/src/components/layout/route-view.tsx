"use client";

import dynamic from "next/dynamic";

/** Renders the page for the current URL inside the dashboard shell. */
export const RouteView = dynamic(
  () => import("@/components/layout/route-view-content"),
  { ssr: false },
);
