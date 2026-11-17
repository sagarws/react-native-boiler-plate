import type { Metadata } from "next";
import { SystemAdminPage } from "@/features/system-admin/system-admin-page";

export const metadata: Metadata = { title: "System Admin" };

export default function Page() {
  return <SystemAdminPage />;
}
