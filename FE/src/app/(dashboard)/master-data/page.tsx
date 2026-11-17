import type { Metadata } from "next";
import { MasterDataPage } from "@/features/master-data/master-data-page";

export const metadata: Metadata = { title: "Master Data" };

export default function Page() {
  return <MasterDataPage />;
}
