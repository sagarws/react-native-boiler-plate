import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui/states";
import { ImportsPage } from "@/features/imports/imports-page";

export const metadata: Metadata = { title: "External Imports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading imports…" />}>
      <ImportsPage />
    </Suspense>
  );
}
