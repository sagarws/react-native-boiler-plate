import NativeScreenOcr from '@/specs/NativeScreenOcr';
import { logger } from '@/shared/utils';

/**
 * Native helpers for File Management previews: download a Drive file to the
 * app cache, render PDF pages (Android's built-in renderer), and play videos
 * in the app's own player. Callers pass a short-lived access token header —
 * never long-lived credentials. (Lives in capture/services because only this
 * folder may use the native module.)
 */
export type PreviewError = 'unsupported' | 'too_large' | 'preview_failed';

export class PreviewUnavailable extends Error {
  readonly code: PreviewError;
  constructor(code: PreviewError) {
    super(code);
    this.name = 'PreviewUnavailable';
    this.code = code;
  }
}

function previewError(error: unknown): PreviewError {
  return (error as { code?: unknown } | null)?.code === 'too_large'
    ? 'too_large'
    : 'preview_failed';
}

export const filePreviewService = {
  /** Downloads once (cached); resolves the local path. */
  async download(url: string, authorization: string): Promise<string> {
    if (!NativeScreenOcr) throw new PreviewUnavailable('unsupported');
    try {
      return await NativeScreenOcr.downloadPreviewFile(url, authorization);
    } catch (error) {
      logger.warn('filePreview.download failed', (error as Error)?.message);
      throw new PreviewUnavailable(previewError(error));
    }
  },

  async pdfPageCount(path: string): Promise<number> {
    if (!NativeScreenOcr) throw new PreviewUnavailable('unsupported');
    try {
      return await NativeScreenOcr.getPdfPageCount(path);
    } catch {
      throw new PreviewUnavailable('preview_failed');
    }
  },

  /** A rendered page as a file:// URI, [width] px wide. */
  async renderPdfPage(
    path: string,
    page: number,
    width: number,
  ): Promise<string> {
    if (!NativeScreenOcr) throw new PreviewUnavailable('unsupported');
    try {
      return await NativeScreenOcr.renderPdfPage(path, page, Math.round(width));
    } catch {
      throw new PreviewUnavailable('preview_failed');
    }
  },

  clearCache(): void {
    NativeScreenOcr?.clearPreviewCache();
  },

  /** Opens the in-app video player. False when unavailable. */
  playVideo(url: string, authorization: string, title: string): boolean {
    if (!NativeScreenOcr) return false;
    NativeScreenOcr.playVideo(url, authorization, title);
    return true;
  },
};
