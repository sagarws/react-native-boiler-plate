"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";

/**
 * Full-screen image slider (TrackVid's fullscreen image modal, with prev / next across the step's screenshots).
 * Built on the template carousel classes; ← / → keys move between images.
 */
export function ImageLightbox({ images, start, title, onClose }: { images: readonly string[]; start: number; title: string; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const count = images.length;
  const current = images[Math.min(index, count - 1)];

  useEffect(() => {
    if (count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + count) % count);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  if (!current) return null;
  return (
    <AppDialog title={count > 1 ? `${title} (${index + 1} / ${count})` : title} size="xl" onClose={onClose} className="tv-whats-new-lightbox">
      <div className="tv-carousel tv-whats-new-slider" role="group" aria-roledescription="carousel" aria-label={title}>
        <img src={current} alt={`${title} ${index + 1}`} />
        {count > 1 ? (
          <>
            <button type="button" className="tv-carousel-nav prev" aria-label="Previous image" onClick={() => setIndex((i) => (i - 1 + count) % count)}>
              <Icon name="caret-left" />
            </button>
            <button type="button" className="tv-carousel-nav next" aria-label="Next image" onClick={() => setIndex((i) => (i + 1) % count)}>
              <Icon name="caret-right" />
            </button>
            <div className="tv-carousel-dots">
              {images.map((src, i) => (
                <button key={`${src}-${i}`} type="button" aria-label={`Image ${i + 1}`} aria-current={i === index} onClick={() => setIndex(i)} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </AppDialog>
  );
}
