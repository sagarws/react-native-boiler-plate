import type { Metadata } from "next";
import { ManageRolesPage } from "@/features/users-roles/manage-roles-page";

export const metadata: Metadata = { title: "Manage Role" };

export default function Page() {
  return <ManageRolesPage />;
}
