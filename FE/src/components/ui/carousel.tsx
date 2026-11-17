"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";

export function Carousel({ images, label = "Images" }: { images: readonly { src: string; alt: string }[]; label?: string }) {
  const [index, setIndex] = useState(0);
  if (!images.length) return null;
  const current = images[Math.min(index, images.length - 1)];
  const go = (d: number) => setIndex((i) => (i + d + images.length) % images.length);
  return (
    <div className="tv-carousel" role="group" aria-roledescription="carousel" aria-label={label}>
      <img src={current.src} alt={current.alt} />
      {images.length > 1 ? (
        <>
          <button type="button" className="tv-carousel-nav prev" aria-label="Previous image" onClick={() => go(-1)}>
            <Icon name="caret-left" />
          </button>
          <button type="button" className="tv-carousel-nav next" aria-label="Next image" onClick={() => go(1)}>
            <Icon name="caret-right" />
          </button>
          <div className="tv-carousel-dots">
            {images.map((img, i) => (
              <button key={img.src + i} type="button" aria-label={`Image ${i + 1}`} aria-current={i === index} onClick={() => setIndex(i)} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
