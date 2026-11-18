export const PHOTO_MODES = ['fit', 'fill', 'crop'] as const;
export type PhotoMode = (typeof PHOTO_MODES)[number];

/** Largest shape, in launcher cells, the editor offers. */
export const MAX_CELLS = 4;

/** One photo widget setting (mirrors android/.../photowidget/PhotoWidgetStore.kt). */
export interface PhotoWidget {
  id: string;
  name: string;
  /** Private photo file path (app storage). */
  image: string;
  imgW: number;
  imgH: number;
  mode: PhotoMode;
  /** Chosen shape in cells; 0 × 0 = match the widget's size. */
  frameW: number;
  frameH: number;
  /** Crop focus point, 0–1 of the photo. */
  focusX: number;
  focusY: number;
  /** Crop zoom, 1–4. */
  zoom: number;
  /** Rounded corners, dp. */
  corner: number;
  updatedAt: number;
  /** How many placed home-screen widgets show it. */
  placed: number;
}
