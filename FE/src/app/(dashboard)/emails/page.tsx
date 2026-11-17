import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui/states";
import { EmailInbox } from "@/features/emails/email-inbox";

export const metadata: Metadata = { title: "AJIO Emails" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading emails…" />}>
      <EmailInbox />
    </Suspense>
  );
}
