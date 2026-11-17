import type { ReactNode } from "react";
import { StandaloneShell } from "@/components/layout/standalone-shell";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <StandaloneShell>{children}</StandaloneShell>;
}
