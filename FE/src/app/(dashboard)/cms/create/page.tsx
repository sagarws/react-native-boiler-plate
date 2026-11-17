import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingState } from "@/components/ui/states";
import { CreateCmsPage } from "@/features/cms-create/create-cms-page";

export const metadata: Metadata = { title: "Create SPF Claim" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading claim form…" />}>
      <CreateCmsPage mode="create" />
    </Suspense>
  );
}
