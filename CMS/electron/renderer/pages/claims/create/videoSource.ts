import { type SyntheticEvent } from "react";

/**
 * Cloud videos live under `raw/<name>` only while they are being compressed.
 * When the container finishes it uploads `processed/<name>` and DELETES the raw
 * object, so any link frozen before that (a CMS claim body, a master-import
 * row) now 404s and the <video> renders as a black tile.
 *
 * Returns the `processed/` twin of such a link, or null when there is nothing
 * to swap.
 */
export const toProcessedVideoUrl = (url?: string | null): string | null => {
  if (typeof url !== "string" || url.trim() === "") return null;
  if (!/^https?:\/\//i.test(url) || !url.includes("/raw/")) return null;
  return url.replace("/raw/", "/processed/");
};

/**
 * One-shot <video onError> recovery: retry a failed `raw/` source against its
 * compressed twin.
 *
 * Deliberately a fallback rather than an up-front rewrite — a video that is
 * genuinely still processing (or whose processing failed) has ONLY the raw
 * copy, and swapping every link would break the previews that work today. The
 * dataset flag stops a second failure from looping.
 */
export const retryVideoAsProcessed = (event: SyntheticEvent<HTMLVideoElement>) => {
  const video = event.currentTarget;
  if (video.dataset.processedRetry === "done") return;

  const processedUrl = toProcessedVideoUrl(video.getAttribute("src"));
  if (!processedUrl) return;

  video.dataset.processedRetry = "done";
  video.src = processedUrl;
  video.load();
};
