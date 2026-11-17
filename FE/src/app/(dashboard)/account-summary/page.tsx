import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui/states";
import { AccountSummaryPage } from "@/features/accounts/account-summary-page";

export const metadata: Metadata = { title: "Accounts" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading accounts…" />}>
      <AccountSummaryPage />
    </Suspense>
  );
}
