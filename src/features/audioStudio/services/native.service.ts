import { DeviceEventEmitter } from 'react-native';
import NativeAudioStudio from '@/specs/NativeAudioStudio';
import type { PlayerState, RepeatMode, Song } from '../types';

/*
 * The 8D Audio Studio native module. Absent on iOS / under Jest: calls are
 * then no-ops and reads resolve empty, so the screens still render.
 */

const M = NativeAudioStudio;

export const EMPTY_STATE: PlayerState = {
  queue: [],
  index: -1,
  playing: false,
  buffering: false,
  positionMs: 0,
  durationMs: 0,
  repeat: 'off',
  shuffle: false,
  speed: 1,
  sleepAt: null,
  sleepEndOfTrack: false,
  error: null,
  at: 0,
};

export const parseState = (json: string): PlayerState => {
  try {
    const o = JSON.parse(json) as Partial<PlayerState>;
    return {
      ...EMPTY_STATE,
      ...o,
      queue: Array.isArray(o.queue) ? o.queue.map(String) : [],
      repeat: (['off', 'one', 'all'] as RepeatMode[]).includes(
        o.repeat as RepeatMode,
      )
        ? (o.repeat as RepeatMode)
        : 'off',
      at: Date.now(),
    };
  } catch {
    return { ...EMPTY_STATE, at: Date.now() };
  }
};

export type StudioEvent =
  | { type: 'state'; state: PlayerState }
  | { type: 'track'; id: string };

const songsJson = (songs: Song[]) => JSON.stringify(songs);

export const audioNative = {
  available: !!M,

  async scanLibrary(): Promise<string> {
    if (!M) return '[]';
    return M.scanLibrary();
  },
  async importFiles(uris: string[]): Promise<string> {
    if (!M || uris.length === 0) return '[]';
    return M.importFiles(uris);
  },

  setQueue(
    songs: Song[],
    startIndex: number,
    positionMs: number,
    play: boolean,
  ) {
    M?.setQueue(
      songsJson(songs),
      startIndex,
      Math.max(0, Math.round(positionMs)),
      play,
    );
  },
  addToQueue(songs: Song[], index: number) {
    if (songs.length) M?.addToQueue(songsJson(songs), index);
  },
  removeFromQueue: (i: number) => M?.removeFromQueue(i),
  moveQueueItem: (from: number, to: number) => M?.moveQueueItem(from, to),
  clearQueue: () => M?.clearQueue(),
  play: () => M?.play(),
  pause: () => M?.pause(),
  next: () => M?.next(),
  previous: () => M?.previous(),
  seekTo: (ms: number) => M?.seekTo(Math.max(0, Math.round(ms))),
  skipTo: (i: number) => M?.skipTo(i),
  setRepeatMode: (mode: RepeatMode) => M?.setRepeatMode(mode),
  setShuffle: (on: boolean) => M?.setShuffle(on),
  setSpeed: (speed: number) => M?.setSpeed(speed),
  setSleepTimer: (minutes: number, endOfTrack: boolean) =>
    M?.setSleepTimer(minutes, endOfTrack),
  setCrossfade: (ms: number) => M?.setCrossfade(ms),
  async getState(): Promise<PlayerState> {
    if (!M) return { ...EMPTY_STATE, at: Date.now() };
    return parseState(await M.getState());
  },
  setDspParams: (params: number[]) => M?.setDspParams(params),
  async getDspState(): Promise<number[] | null> {
    if (!M) return null;
    try {
      return await M.getDspState();
    } catch {
      return null;
    }
  },

  onEvent(listener: (e: StudioEvent) => void): () => void {
    const sub = DeviceEventEmitter.addListener(
      'AudioStudioEvent',
      (e: { type?: string; body?: string }) => {
        if (e.type === 'state')
          listener({ type: 'state', state: parseState(e.body ?? '{}') });
        else if (e.type === 'track') {
          try {
            const id = (JSON.parse(e.body ?? '{}') as { id?: unknown }).id;
            if (typeof id === 'string') listener({ type: 'track', id });
          } catch {
            /* ignore */
          }
        }
      },
    );
    return () => sub.remove();
  },
};
