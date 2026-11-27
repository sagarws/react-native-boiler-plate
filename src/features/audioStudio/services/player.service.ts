import {
  collectionsStore,
  RECENT_MAX,
  sessionStore,
  studioStore,
} from '../store/stores';
import type { PlayerState, RepeatMode, Song } from '../types';
import { libraryService } from './library.service';
import { EMPTY_STATE, audioNative } from './native.service';

/*
 * The player as JS sees it. The native player owns the queue (so it keeps
 * playing in the background); this mirrors its state from events, records
 * recently played, and saves the queue so it comes back after a restart.
 */

type Listener = () => void;

class PlayerService {
  private state: PlayerState = EMPTY_STATE;
  private readonly listeners = new Set<Listener>();
  private started = false;
  /** Songs that have been queued, by id (the queue holds only ids). */
  private readonly known = new Map<string, Song>();

  get snapshot(): PlayerState {
    return this.state;
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private set(next: PlayerState) {
    this.state = next;
    this.listeners.forEach(l => l());
  }

  song(id: string | undefined): Song | null {
    if (!id) return null;
    const hit = this.known.get(id);
    if (hit) return hit;
    const found = libraryService.all().find(s => s.id === id) ?? null;
    if (found) this.known.set(id, found);
    return found;
  }

  get current(): Song | null {
    return this.song(this.state.queue[this.state.index]);
  }

  /** Once per app run: listen to native, restore the saved queue (paused). */
  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    audioNative.onEvent(e => {
      if (e.type === 'state') {
        this.set(e.state);
        this.save(e.state);
      } else this.recordPlayed(e.id);
    });
    const { speed, crossfadeMs } = studioStore.read();
    audioNative.setSpeed(speed);
    audioNative.setCrossfade(crossfadeMs);
    const live = await audioNative.getState();
    if (live.queue.length) return this.set(live);
    const saved = sessionStore.read();
    const songs = saved.queue
      .map(id => this.song(id))
      .filter((s): s is Song => s !== null);
    if (songs.length) {
      const index = Math.min(saved.index, songs.length - 1);
      audioNative.setQueue(songs, index, saved.positionMs, false);
    }
  }

  private save(s: PlayerState) {
    sessionStore.set({
      queue: s.queue,
      index: Math.max(0, s.index),
      positionMs: s.positionMs,
    });
  }

  private recordPlayed(id: string) {
    collectionsStore.update(c => ({
      ...c,
      recent: [
        { id, at: Date.now() },
        ...c.recent.filter(r => r.id !== id),
      ].slice(0, RECENT_MAX),
    }));
  }

  /** Position now, interpolated between events while playing. */
  position(now = Date.now()): number {
    const s = this.state;
    if (!s.playing || s.buffering) return s.positionMs;
    const p = s.positionMs + (now - s.at) * s.speed;
    return s.durationMs > 0 ? Math.min(p, s.durationMs) : p;
  }

  private remember(songs: Song[]) {
    for (const s of songs) this.known.set(s.id, s);
  }

  // ── actions ──

  playSongs(songs: Song[], startIndex = 0, shuffle = false) {
    if (!songs.length) return;
    this.remember(songs);
    audioNative.setShuffle(shuffle);
    const start = shuffle
      ? Math.floor(Math.random() * songs.length)
      : startIndex;
    audioNative.setQueue(songs, start, 0, true);
  }

  playNext(songs: Song[]) {
    this.remember(songs);
    if (!this.state.queue.length) return this.playSongs(songs);
    audioNative.addToQueue(songs, -2);
  }

  addToQueue(songs: Song[]) {
    this.remember(songs);
    if (!this.state.queue.length) return this.playSongs(songs);
    audioNative.addToQueue(songs, -1);
  }

  removeAt = (i: number) => audioNative.removeFromQueue(i);
  move = (from: number, to: number) => {
    if (from !== to) audioNative.moveQueueItem(from, to);
  };
  clear = () => audioNative.clearQueue();
  toggle = () =>
    this.state.playing ? audioNative.pause() : audioNative.play();
  next = () => audioNative.next();
  previous = () => audioNative.previous();
  seek = (ms: number) => {
    // Show the new position at once; the native event confirms it.
    this.set({ ...this.state, positionMs: ms, at: Date.now() });
    audioNative.seekTo(ms);
  };
  skipTo = (i: number) => audioNative.skipTo(i);
  cycleRepeat = () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    audioNative.setRepeatMode(
      order[(order.indexOf(this.state.repeat) + 1) % 3]!,
    );
  };
  toggleShuffle = () => audioNative.setShuffle(!this.state.shuffle);
  setSpeed = (speed: number) => {
    studioStore.update(d => ({ ...d, speed }));
    audioNative.setSpeed(speed);
  };
  setCrossfade = (ms: number) => {
    studioStore.update(d => ({ ...d, crossfadeMs: ms }));
    audioNative.setCrossfade(ms);
  };
  setSleepTimer = (minutes: number, endOfTrack = false) =>
    audioNative.setSleepTimer(minutes, endOfTrack);

  /** The queue as songs (unknown ids — deleted files — are skipped). */
  queueSongs(): { song: Song; index: number }[] {
    return this.state.queue
      .map((id, index) => ({ song: this.song(id), index }))
      .filter((x): x is { song: Song; index: number } => x.song !== null);
  }
}

export const playerService = new PlayerService();
