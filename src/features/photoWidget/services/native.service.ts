import NativePhotoWidget from '@/specs/NativePhotoWidget';
import { logger } from '@/shared/utils';
import { PHOTO_MODES, type PhotoMode, type PhotoWidget } from '../types';

export class PhotoWidgetError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const errorCode = (error: unknown) =>
  (error as { code?: string })?.code || 'failed';

type R = Record<string, unknown>;
const num = (v: unknown, min: number, max: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : d;

/** Validates one widget from native JSON; null when unusable. */
export function cleanWidget(r: R): PhotoWidget | null {
  if (typeof r.id !== 'string' || typeof r.image !== 'string' || !r.image)
    return null;
  const frameW = Math.round(num(r.frameW, 0, 6, 0));
  const frameH = Math.round(num(r.frameH, 0, 6, 0));
  const shaped = frameW > 0 && frameH > 0;
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name.slice(0, 40) : '',
    image: r.image,
    imgW: Math.round(num(r.imgW, 0, 100_000, 0)),
    imgH: Math.round(num(r.imgH, 0, 100_000, 0)),
    mode: PHOTO_MODES.includes(r.mode as PhotoMode)
      ? (r.mode as PhotoMode)
      : 'fill',
    frameW: shaped ? frameW : 0,
    frameH: shaped ? frameH : 0,
    focusX: num(r.focusX, 0, 1, 0.5),
    focusY: num(r.focusY, 0, 1, 0.5),
    zoom: num(r.zoom, 1, 4, 1),
    corner: Math.round(num(r.corner, 0, 48, 16)),
    updatedAt: num(r.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    placed: Math.round(num(r.placed, 0, 1000, 0)),
  };
}

/**
 * Photo Widget's bridge to Android. Photos are copied into private app
 * storage; only their paths travel over the bridge.
 */
export const photoWidgetNative = {
  available: (): boolean => NativePhotoWidget != null,

  async list(): Promise<{ widgets: PhotoWidget[]; pinSupported: boolean }> {
    if (!NativePhotoWidget) return { widgets: [], pinSupported: false };
    try {
      const r = JSON.parse(await NativePhotoWidget.list()) as R;
      const widgets = Array.isArray(r.widgets)
        ? r.widgets
            .map(w => (w && typeof w === 'object' ? cleanWidget(w as R) : null))
            .filter((w): w is PhotoWidget => w !== null)
        : [];
      return { widgets, pinSupported: r.pinSupported === true };
    } catch (error) {
      logger.warn('photo widget list failed', errorCode(error));
      throw new PhotoWidgetError(errorCode(error));
    }
  },

  /** {path, width, height}, or null when cancelled. */
  async pickImage(): Promise<{
    path: string;
    width: number;
    height: number;
  } | null> {
    if (!NativePhotoWidget) throw new PhotoWidgetError('unavailable');
    try {
      const raw = await NativePhotoWidget.pickImage();
      if (!raw) return null;
      const r = JSON.parse(raw) as R;
      if (typeof r.path !== 'string') return null;
      return {
        path: r.path,
        width: num(r.width, 1, 100_000, 1),
        height: num(r.height, 1, 100_000, 1),
      };
    } catch (error) {
      logger.warn('photo pick failed', errorCode(error));
      throw new PhotoWidgetError(errorCode(error));
    }
  },

  async save(w: PhotoWidget): Promise<void> {
    if (!NativePhotoWidget) throw new PhotoWidgetError('unavailable');
    // `placed` is computed natively, never stored.
    const config: Omit<PhotoWidget, 'placed'> & { placed?: number } = { ...w };
    delete config.placed;
    try {
      await NativePhotoWidget.save(JSON.stringify(config));
    } catch (error) {
      logger.warn('photo widget save failed', errorCode(error));
      throw new PhotoWidgetError(errorCode(error));
    }
  },

  async remove(id: string): Promise<void> {
    if (!NativePhotoWidget) return;
    await NativePhotoWidget.remove(id);
  },

  discardImage(path: string) {
    NativePhotoWidget?.discardImage(path);
  },

  async requestPin(id: string): Promise<boolean> {
    if (!NativePhotoWidget) return false;
    try {
      return await NativePhotoWidget.requestPin(id);
    } catch (error) {
      logger.warn('photo widget pin failed', errorCode(error));
      return false;
    }
  },
};
