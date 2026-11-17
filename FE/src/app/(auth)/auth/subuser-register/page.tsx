import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatusCard } from "@/features/auth/auth-frame";
import { SubUserRegisterPage } from "@/features/auth/subuser-register-page";
import { RestrictedGuard } from "@/features/auth/restricted-guard";

export const metadata: Metadata = { title: "Register" };

export default function Page() {
  return (
    <Suspense fallback={<AuthStatusCard state="loading" title="Loading…" />}>
      <RestrictedGuard>
        <SubUserRegisterPage />
      </RestrictedGuard>
    </Suspense>
  );
}
