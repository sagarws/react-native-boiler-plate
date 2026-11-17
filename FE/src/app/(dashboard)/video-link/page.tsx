import type { Metadata } from "next";
import { VideoLinkPage } from "@/features/video-link/video-link-page";

export const metadata: Metadata = { title: "Video Link" };

export default function Page() {
  return <VideoLinkPage />;
}
