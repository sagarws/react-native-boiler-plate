import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { audioNative } from '../services/native.service';
import { libraryService } from '../services/library.service';
import { playerService } from '../services/player.service';
import { studioService } from '../services/studio.service';
import { collectionsStore, libraryStore, studioStore } from '../store/stores';
import type { PlayerState, Song } from '../types';

export const usePlayer = (): PlayerState =>
  useSyncExternalStore(playerService.subscribe, () => playerService.snapshot);

export const useCollections = () =>
  useSyncExternalStore(collectionsStore.subscribe, collectionsStore.read);

export const useStudio = () =>
  useSyncExternalStore(studioStore.subscribe, studioStore.read);

/** Every song (scanned + imported); stable until the library changes. */
export const useSongs = (): Song[] => {
  const lib = useSyncExternalStore(libraryStore.subscribe, libraryStore.read);
  return useMemo(() => [...lib.scanned, ...lib.imported], [lib]);
};

export const useLibraryInfo = () =>
  useSyncExternalStore(libraryStore.subscribe, libraryStore.read);

/**
 * Only the playing song's id: unlike usePlayer, a component using this does
 * not re-render on every state event (position, buffering, …).
 */
export const useCurrentSongId = (): string | null =>
  useSyncExternalStore(playerService.subscribe, () => {
    const s = playerService.snapshot;
    return s.queue[s.index] ?? null;
  });

export const useCurrentSong = (): Song | null => {
  const s = usePlayer();
  return playerService.song(s.queue[s.index]);
};

/** Playback position, re-rendering ~4×/s only while playing. */
export const usePosition = (): number => {
  const s = usePlayer();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s.playing) return;
    const t = setInterval(() => tick(n => n + 1), 500);
    return () => clearInterval(t);
  }, [s.playing]);
  return playerService.position();
};

export interface DspLive {
  azimuth: number;
  elevation: number;
  distance: number;
  peakL: number;
  peakR: number;
  gainReductionDb: number;
}

/**
 * The engine's real, current source position and output level, polled while
 * `active` (the studio view is visible and music plays) — the animation
 * follows the actual sound, not a separate guess.
 */
export const useDspLive = (active: boolean): DspLive | null => {
  const [live, setLive] = useState<DspLive | null>(null);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const poll = async () => {
      const s = await audioNative.getDspState();
      if (stop) return;
      if (s && s.length >= 6)
        setLive({
          azimuth: s[0]!,
          elevation: s[1]!,
          distance: s[2]!,
          peakL: s[3]!,
          peakR: s[4]!,
          gainReductionDb: s[5]!,
        });
      // ~7 Hz is enough: the dot glides between samples on the UI thread.
      setTimeout(poll, 150);
    };
    poll();
    return () => {
      stop = true;
    };
  }, [active]);
  return live;
};

/** Starts the player mirror and pushes saved DSP settings (once per run). */
export const useAudioStudioInit = () => {
  useEffect(() => {
    playerService.init();
    studioService.sync();
    const { scannedAt } = libraryStore.read();
    if (scannedAt === null) libraryService.scan();
  }, []);
};
