import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatusCard } from "@/features/auth/auth-frame";
import { ResetPasswordPage } from "@/features/auth/reset-password-page";
import { RestrictedGuard } from "@/features/auth/restricted-guard";

export const metadata: Metadata = { title: "Reset Password" };

export default function Page() {
  return (
    <Suspense fallback={<AuthStatusCard state="loading" title="Loading…" />}>
      <RestrictedGuard>
        <ResetPasswordPage />
      </RestrictedGuard>
    </Suspense>
  );
}
