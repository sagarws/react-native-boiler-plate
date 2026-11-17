import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatusCard } from "@/features/auth/auth-frame";
import { ZohoCallbackPage } from "@/features/auth/zoho-callback-page";

export const metadata: Metadata = { title: "Connecting Zoho" };

export default function Page() {
  return (
    <Suspense fallback={<AuthStatusCard state="loading" title="Loading…" />}>
      <ZohoCallbackPage />
    </Suspense>
  );
}
