"use client";

import { useState } from "react";
import type { ExistingCmsPreview } from "@/types/cms-create";
import type { MediaSrc } from "@/features/cms-create/media/media-thumb";

export interface VideoPreviews {
  returnVideo: MediaSrc | null;
  forwardVideo: MediaSrc | null;
}

/**
 * Return / Forward video previews for LeftVideos. A loaded claim (/cms/update) fills them from its stored links once
 * per claim id — adjusted during render, so no effect round-trip.
 */
export function useVideoPreviews(existingClaim: ExistingCmsPreview | null) {
  const [previews, setPreviews] = useState<VideoPreviews>({ returnVideo: null, forwardVideo: null });
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  if (existingClaim && existingClaim._id !== hydratedId) {
    setHydratedId(existingClaim._id);
    setPreviews((prev) => ({ returnVideo: existingClaim.returnVideoLink || prev.returnVideo, forwardVideo: existingClaim.forwardVideoLink || prev.forwardVideo }));
  }
  const onPreviewChange = (name: string, file: File | null) => setPreviews((prev) => ({ ...prev, [name]: file }));
  const onLinkChange = (side: "returnVideo" | "forwardVideo", value: string) => setPreviews((prev) => ({ ...prev, [side]: value || null }));
  return { previews, setPreviews, onPreviewChange, onLinkChange };
}

/** Same idea for any named set of image slots: hydrate once per loaded claim id from `fromClaim`. */
export function useSlotPreviews(existingClaim: ExistingCmsPreview | null, fromClaim: (claim: ExistingCmsPreview) => Record<string, MediaSrc | null>) {
  const [previews, setPreviews] = useState<Record<string, MediaSrc | null>>({});
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  if (existingClaim && existingClaim._id !== hydratedId) {
    setHydratedId(existingClaim._id);
    const loaded = fromClaim(existingClaim);
    setPreviews((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(loaded)) if (v) next[k] = v;
      return next;
    });
  }
  return [previews, setPreviews] as const;
}
