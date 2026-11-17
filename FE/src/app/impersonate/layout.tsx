import type { ReactNode } from "react";
import { StandaloneShell } from "@/components/layout/standalone-shell";

/** Store + toasts for this page, outside the dashboard shell (same as the auth layout). */
export default function Layout({ children }: { children: ReactNode }) {
  return <StandaloneShell>{children}</StandaloneShell>;
}
