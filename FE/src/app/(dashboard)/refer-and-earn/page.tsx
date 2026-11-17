import type { Metadata } from "next";
import { ReferAndEarnPage } from "@/features/refer-and-earn/refer-and-earn-page";

export const metadata: Metadata = { title: "Refer & Earn" };

export default function Page() {
  return <ReferAndEarnPage />;
}
