/** Where the remote screen is drawn, and screen touches → 0–1 remote coordinates. */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The video fitted ("contain") in the container, zoomed, moved by `pan`. */
export const videoRect = (
  container: Size,
  video: Size,
  zoom: number,
  pan: { x: number; y: number },
  /** Put a picture shorter than the container at its top (keyboard open), not in the middle. */
  alignTop = false,
): Rect => {
  if (!container.width || !container.height || !video.width || !video.height)
    return {
      left: 0,
      top: 0,
      width: container.width,
      height: container.height,
    };
  const fit = Math.min(
    container.width / video.width,
    container.height / video.height,
  );
  const width = video.width * fit * zoom;
  const height = video.height * fit * zoom;
  return {
    left: (container.width - width) / 2 + pan.x,
    top:
      alignTop && height <= container.height
        ? pan.y
        : (container.height - height) / 2 + pan.y,
    width,
    height,
  };
};

/** Keep the zoomed picture covering the container (no empty edges while zoomed in). */
export const clampPan = (
  container: Size,
  video: Size,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } => {
  const r = videoRect(container, video, zoom, { x: 0, y: 0 });
  const limitX = Math.max(0, (r.width - container.width) / 2);
  const limitY = Math.max(0, (r.height - container.height) / 2);
  return {
    x: Math.min(limitX, Math.max(-limitX, pan.x)),
    y: Math.min(limitY, Math.max(-limitY, pan.y)),
  };
};

/** A touch at (x, y) on the screen → 0–1 of the remote display, or null outside the picture. */
export const toRemotePoint = (
  rect: Rect,
  x: number,
  y: number,
): { x: number; y: number } | null => {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const nx = (x - rect.left) / rect.width;
  const ny = (y - rect.top) / rect.height;
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null;
  return {
    x: Math.round(nx * 100_000) / 100_000,
    y: Math.round(ny * 100_000) / 100_000,
  };
};
