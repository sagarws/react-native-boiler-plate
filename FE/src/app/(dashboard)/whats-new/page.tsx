import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui/states";
import { WhatsNewPage } from "@/features/whats-new/whats-new-page";

export const metadata: Metadata = { title: "What's New" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading updates…" />}>
      <WhatsNewPage />
    </Suspense>
  );
}
