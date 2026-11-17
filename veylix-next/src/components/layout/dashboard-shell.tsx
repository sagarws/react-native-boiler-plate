"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

/**
 * The dashboard is a browser-only app: it reads localStorage, IndexedDB and
 * window size while rendering, exactly like the original. Loading the shell
 * without server rendering keeps the markup identical and avoids hydration
 * mismatches.
 */
const AppShell = dynamic(() => import("@/components/layout/app-shell"), {
  ssr: false,
});

export function DashboardShell({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
