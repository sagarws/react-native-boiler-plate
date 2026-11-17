import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatusCard } from "@/features/auth/auth-frame";
import { ForgotPasswordPage } from "@/features/auth/forgot-password-page";
import { RestrictedGuard } from "@/features/auth/restricted-guard";

export const metadata: Metadata = { title: "Forgot Password" };

export default function Page() {
  return (
    <Suspense fallback={<AuthStatusCard state="loading" title="Loading…" />}>
      <RestrictedGuard>
        <ForgotPasswordPage />
      </RestrictedGuard>
    </Suspense>
  );
}
