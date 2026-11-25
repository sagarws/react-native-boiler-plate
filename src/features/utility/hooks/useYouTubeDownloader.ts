import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { logger, requestNotificationPermission } from '@/shared/utils';
import { youtubeNative } from '../services/youtube.service';
import { canonicalYouTubeUrl } from '../services/youtube';
import type {
  ActiveDownload,
  DownloadEntry,
  DownloadKind,
  DownloadOption,
  VideoDetails,
} from '../youtube.types';

export type LookupState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; details: VideoDetails }
  | { kind: 'error'; code: string };

export interface UseYouTubeDownloader {
  available: boolean;
  lookup: LookupState;
  mode: DownloadKind;
  setMode: (mode: DownloadKind) => void;
  /** Options for the current mode (highest quality first). */
  options: DownloadOption[];
  selectedId: string | null;
  select: (id: string) => void;
  active: ActiveDownload | null;
  starting: boolean;
  downloads: DownloadEntry[];
  /** Last download error code until dismissed. */
  downloadError: string | null;
  /** Set when the last download finished, until dismissed. */
  justCompleted: DownloadEntry | null;
  dismiss: () => void;
  fetchInfo: (link: string) => Promise<void>;
  reset: () => void;
  download: () => Promise<void>;
  cancel: () => void;
  open: (id: string) => Promise<boolean>;
  share: (id: string) => Promise<boolean>;
  remove: (id: string, deleteFile: boolean) => Promise<void>;
}

const codeOf = (error: unknown) =>
  (error as { code?: string })?.code || 'download_failed';

/** Default pick: 1080p if offered (fast, plays everywhere), else the best. */
export function defaultOption(options: DownloadOption[]): string | null {
  if (!options.length) return null;
  const hd = options.find(o => o.kind === 'video' && o.height === 1080);
  return (hd ?? options[0]).id;
}

/**
 * YouTube Downloader state: link lookup → quality choice → background
 * download (progress from native events) → the downloads list. The running
 * download is re-read when the screen mounts or the app returns to the
 * foreground, since it continues in a native service.
 */
export function useYouTubeDownloader(): UseYouTubeDownloader {
  const [lookup, setLookup] = useState<LookupState>({ kind: 'idle' });
  const [mode, setModeState] = useState<DownloadKind>('video');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveDownload | null>(null);
  const [starting, setStarting] = useState(false);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState<DownloadEntry | null>(
    null,
  );
  const mounted = useRef(true);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [list, running] = await Promise.all([
        youtubeNative.downloads(),
        youtubeNative.active(),
      ]);
      if (!mounted.current) return;
      setDownloads(list);
      setActive(running);
    } catch (error) {
      logger.warn('youtube refresh failed', codeOf(error));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const app = AppState.addEventListener('change', s => {
      if (s === 'active') void refresh();
    });
    const off = youtubeNative.onEvent(event => {
      switch (event.type) {
        case 'progress':
          setActive(event.active);
          break;
        case 'completed':
          setActive(null);
          setJustCompleted(event.entry);
          setDownloads(prev => [
            event.entry,
            ...prev.filter(d => d.id !== event.entry.id),
          ]);
          break;
        case 'failed':
          setActive(null);
          setDownloadError(event.code);
          break;
        case 'cancelled':
          setActive(null);
          break;
      }
    });
    return () => {
      mounted.current = false;
      app.remove();
      off();
    };
  }, [refresh]);

  const optionsFor = (state: LookupState, kind: DownloadKind) =>
    state.kind === 'ready'
      ? kind === 'video'
        ? state.details.video
        : state.details.audio
      : [];

  const fetchInfo = useCallback(async (link: string) => {
    const url = canonicalYouTubeUrl(link);
    if (!url) {
      setLookup({ kind: 'error', code: 'invalid_url' });
      return;
    }
    const id = ++request.current;
    setLookup({ kind: 'loading' });
    setSelectedId(null);
    try {
      const details = await youtubeNative.videoInfo(url);
      if (!mounted.current || id !== request.current) return;
      const kind: DownloadKind = details.video.length ? 'video' : 'audio';
      setModeState(kind);
      setLookup({ kind: 'ready', details });
      setSelectedId(
        defaultOption(optionsFor({ kind: 'ready', details }, kind)),
      );
    } catch (error) {
      if (!mounted.current || id !== request.current) return;
      setLookup({ kind: 'error', code: codeOf(error) });
    }
  }, []);

  const setMode = useCallback(
    (next: DownloadKind) => {
      setModeState(next);
      setSelectedId(defaultOption(optionsFor(lookup, next)));
    },
    [lookup],
  );

  const reset = useCallback(() => {
    request.current++;
    setLookup({ kind: 'idle' });
    setSelectedId(null);
  }, []);

  const download = useCallback(async () => {
    if (lookup.kind !== 'ready' || !selectedId || active || starting) return;
    setStarting(true);
    setDownloadError(null);
    setJustCompleted(null);
    try {
      // Progress shows in a notification; ask once (Android 13+). The
      // download runs either way.
      await requestNotificationPermission();
      await youtubeNative.start(lookup.details.url, selectedId);
      const option = optionsFor(lookup, mode).find(o => o.id === selectedId);
      if (mounted.current) {
        setActive(
          prev =>
            prev ?? {
              id: '',
              title: lookup.details.title,
              label: option?.label ?? '',
              phase: 'fetching',
              fraction: 0,
            },
        );
      }
    } catch (error) {
      if (mounted.current) setDownloadError(codeOf(error));
    } finally {
      if (mounted.current) setStarting(false);
    }
  }, [lookup, selectedId, active, starting, mode]);

  const remove = useCallback(async (id: string, deleteFile: boolean) => {
    try {
      await youtubeNative.remove(id, deleteFile);
      setDownloads(prev => prev.filter(d => d.id !== id));
    } catch (error) {
      logger.warn('youtube remove failed', codeOf(error));
      setDownloadError('download_failed');
    }
  }, []);

  return {
    available: youtubeNative.available(),
    lookup,
    mode,
    setMode,
    options: optionsFor(lookup, mode),
    selectedId,
    select: setSelectedId,
    active,
    starting,
    downloads,
    downloadError,
    justCompleted,
    dismiss: () => {
      setDownloadError(null);
      setJustCompleted(null);
    },
    fetchInfo,
    reset,
    download,
    cancel: youtubeNative.cancel,
    open: youtubeNative.open,
    share: youtubeNative.share,
    remove,
  };
}
