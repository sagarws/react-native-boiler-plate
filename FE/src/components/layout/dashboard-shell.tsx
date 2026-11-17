"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

/**
 * The dashboard is browser-only (localStorage session, timers). Loading the shell without server
 * rendering avoids hydration mismatches, the same way the template does it.
 */
const AppShell = dynamic(() => import("@/components/layout/app-shell"), { ssr: false });

export function DashboardShell({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
