import type { CSSProperties } from "react";

export function Skeleton({ width = "100%", height = 14, radius, style }: { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties }) {
  return <span className="tv-skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** A card-shaped placeholder: title bar + a few lines. */
export function SkeletonCard({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <section className="glass-card tv-stack" aria-busy="true" aria-label="Loading" style={height ? { minHeight: height } : undefined}>
      <Skeleton width="40%" height={18} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={`${90 - i * 12}%`} />
      ))}
    </section>
  );
}
