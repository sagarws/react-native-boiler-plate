import type { ReactNode } from "react";

/** Pages outside the dashboard shell (auth, impersonate, OAuth callback). Providers live in the root layout. */
export function StandaloneShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
