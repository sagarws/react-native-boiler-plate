import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui/states";
import { IntegrationsPage } from "@/features/integrations/integrations-page";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading integrations" />}>
      <IntegrationsPage />
    </Suspense>
  );
}
