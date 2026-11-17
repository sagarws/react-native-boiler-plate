"use client";

import { VideoLibrary } from "@/features/vms/video-library";

/** TrackVid `pages/Favorite.tsx`: the VMS table limited to starred videos (favorite::edit gates the edits). */
export function FavoritePage() {
  return <VideoLibrary mode="favorite" />;
}
