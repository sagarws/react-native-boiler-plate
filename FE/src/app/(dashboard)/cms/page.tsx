import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingState } from "@/components/ui/states";
import { CmsPage } from "@/features/cms/cms-page";

export const metadata: Metadata = { title: "Manage SPF Claims" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading claims…" />}>
      <CmsPage />
    </Suspense>
  );
}
