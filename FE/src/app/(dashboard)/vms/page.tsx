import type { Metadata } from "next";
import { VmsPage } from "@/features/vms/vms-page";

export const metadata: Metadata = { title: "VMS" };

export default function Page() {
  return <VmsPage />;
}
