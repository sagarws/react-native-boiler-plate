import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatusCard } from "@/features/auth/auth-frame";
import { RegisterPage } from "@/features/auth/register-page";
import { RestrictedGuard } from "@/features/auth/restricted-guard";

export const metadata: Metadata = { title: "Register" };

export default function Page() {
  return (
    <Suspense fallback={<AuthStatusCard state="loading" title="Loading…" />}>
      <RestrictedGuard>
        <RegisterPage />
      </RestrictedGuard>
    </Suspense>
  );
}
