import { DeviceEventEmitter } from 'react-native';
import NativeYouTubeDownloader from '@/specs/NativeYouTubeDownloader';
import { logger } from '@/shared/utils';
import type {
  ActiveDownload,
  DownloadEntry,
  DownloadEvent,
  VideoDetails,
} from '../youtube.types';
import {
  parseActive,
  parseDownloadEvent,
  parseEntries,
  parseVideoDetails,
} from './youtube';
import { UtilityError } from './native.service';

const errorCode = (error: unknown) =>
  (error as { code?: string })?.code || (error as Error)?.message || 'failed';

function need() {
  if (!NativeYouTubeDownloader) throw new UtilityError('unavailable_platform');
  return NativeYouTubeDownloader;
}

/**
 * The YouTube Downloader's bridge to Android. Extraction, downloading and
 * muxing all run natively (YouTubeDownloaderModule / YtDownloadService).
 * Errors carry a stable code (see KNOWN_ERRORS); titles and URLs are never
 * logged.
 */
export const youtubeNative = {
  available: (): boolean => NativeYouTubeDownloader != null,

  async videoInfo(url: string): Promise<VideoDetails> {
    let json: string;
    try {
      json = await need().getVideoInfo(url);
    } catch (error) {
      const code = errorCode(error);
      logger.warn('youtube info failed', code);
      throw new UtilityError(code);
    }
    const details = parseVideoDetails(json);
    if (!details) throw new UtilityError('no_streams');
    return details;
  },

  async start(url: string, optionId: string): Promise<string> {
    try {
      return await need().startDownload(url, optionId);
    } catch (error) {
      const code = errorCode(error);
      logger.warn('youtube download start failed', code);
      throw new UtilityError(code);
    }
  },

  cancel() {
    NativeYouTubeDownloader?.cancelDownload();
  },

  async active(): Promise<ActiveDownload | null> {
    if (!NativeYouTubeDownloader) return null;
    return parseActive(await NativeYouTubeDownloader.getActiveDownload());
  },

  async downloads(): Promise<DownloadEntry[]> {
    if (!NativeYouTubeDownloader) return [];
    return parseEntries(await NativeYouTubeDownloader.listDownloads());
  },

  async remove(id: string, deleteFile: boolean): Promise<boolean> {
    return need().removeDownload(id, deleteFile);
  },
  async open(id: string): Promise<boolean> {
    return need().openDownload(id);
  },
  async share(id: string): Promise<boolean> {
    return need().shareDownload(id);
  },

  /** Subscribes to download events; returns the unsubscribe function. */
  onEvent(listener: (event: DownloadEvent) => void): () => void {
    const sub = DeviceEventEmitter.addListener(
      'YouTubeDownloadEvent',
      (raw: { type?: unknown; body?: unknown }) => {
        const event = parseDownloadEvent(raw?.type, raw?.body);
        if (event) listener(event);
      },
    );
    return () => sub.remove();
  },
};
