import type { Metadata } from "next";
import { ManageUsersPage } from "@/features/users-roles/manage-users-page";

export const metadata: Metadata = { title: "Manage User" };

export default function Page() {
  return <ManageUsersPage />;
}
