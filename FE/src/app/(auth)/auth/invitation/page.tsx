import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatusCard } from "@/features/auth/auth-frame";
import { InvitationPage } from "@/features/auth/invitation-page";

export const metadata: Metadata = { title: "Invitation" };

export default function Page() {
  return (
    <Suspense fallback={<AuthStatusCard state="loading" title="Loading…" />}>
      <InvitationPage />
    </Suspense>
  );
}
