import type { Metadata } from "next";
import { ImpersonatePage } from "@/features/auth/impersonate-page";

export const metadata: Metadata = { title: "Signing in" };

export default function Page() {
  return <ImpersonatePage />;
}
