"use client";

import { useCallback } from "react";

/** A preview source: a URL (VMS shot, stored claim image, pasted link) or a local file not uploaded anywhere. */
export type MediaSrc = string | File;

export const isFileSrc = (src: MediaSrc | null | undefined): src is File => typeof src === "object" && src !== null;

export const isPdfSrc = (src: MediaSrc | null | undefined): boolean => {
  if (!src) return false;
  if (isFileSrc(src)) return src.type === "application/pdf";
  return /\.pdf($|\?)/i.test(src) || src.startsWith("data:application/pdf");
};

export const srcLabel = (src: MediaSrc): string => (isFileSrc(src) ? src.name : (src.split("/").pop() ?? src));

/**
 * Sets `el.src` from a File through an object URL that is revoked when the element unmounts or the file changes
 * (React 19 ref cleanup), or straight from a URL string.
 */
function useSrcRef<E extends HTMLImageElement | HTMLVideoElement>(src: MediaSrc) {
  return useCallback(
    (el: E | null) => {
      if (!el) return;
      if (!isFileSrc(src)) {
        el.src = src;
        return;
      }
      const url = URL.createObjectURL(src);
      el.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [src],
  );
}

export function MediaImage({ src, alt, className }: { src: MediaSrc; alt: string; className?: string }) {
  const ref = useSrcRef<HTMLImageElement>(src);
  return <img ref={ref} alt={alt} className={className} draggable={false} />;
}

export function MediaVideo({ src, className, autoPlay = false, muted = false }: { src: MediaSrc; className?: string; autoPlay?: boolean; muted?: boolean }) {
  const ref = useSrcRef<HTMLVideoElement>(src);
  return <video ref={ref} className={className} controls autoPlay={autoPlay} muted={muted} playsInline preload="metadata" />;
}
