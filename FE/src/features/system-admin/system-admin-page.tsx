"use client";

import { useState } from "react";
import { PageHeading } from "@/components/ui/page-heading";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { PaymentRequestsTable } from "@/features/system-admin/payment-requests";

type AdminTab = "payment_requests";

const TABS: TabItem<AdminTab>[] = [{ key: "payment_requests", label: "Payment Requests", icon: "receipt" }];

/** TrackVid `SystemAdmin` (roles: system_admin). One tab today: Payment Requests. */
export function SystemAdminPage() {
  const [tab, setTab] = useState<AdminTab>("payment_requests");
  return (
    <div className="tv-page">
      <PageHeading title="System Admin" subtitle="Verify manual UPI and bank-transfer payments and credit customer wallets." />
      <Tabs items={TABS} value={tab} onChange={setTab} label="System admin tabs" />
      <section className="glass-card tv-table-card tv-acc-tab-body" role="tabpanel">
        {tab === "payment_requests" ? <PaymentRequestsTable /> : null}
      </section>
    </div>
  );
}
