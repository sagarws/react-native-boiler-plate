import type { ReactNode } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";

/** Sidebar, topbar, overlays and toasts shared by every dashboard page. */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
