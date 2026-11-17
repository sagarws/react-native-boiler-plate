import type { Metadata } from "next";
import { PendingFailedOrdersPage } from "@/features/pending-failed-orders/pending-failed-orders-page";

export const metadata: Metadata = { title: "Pending & Failed Orders" };

export default function Page() {
  return <PendingFailedOrdersPage />;
}
