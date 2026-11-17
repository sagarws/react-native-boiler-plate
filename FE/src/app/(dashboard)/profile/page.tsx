import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui/states";
import { ProfilePage } from "@/features/profile/profile-page";

export const metadata: Metadata = { title: "Profile" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading profile…" />}>
      <ProfilePage />
    </Suspense>
  );
}
