import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatusCard } from "@/features/auth/auth-frame";
import { LoginPage } from "@/features/auth/login-page";
import { RestrictedGuard } from "@/features/auth/restricted-guard";

export const metadata: Metadata = { title: "Login" };

export default function Page() {
  return (
    <Suspense fallback={<AuthStatusCard state="loading" title="Loading…" />}>
      <RestrictedGuard>
        <LoginPage />
      </RestrictedGuard>
    </Suspense>
  );
}
