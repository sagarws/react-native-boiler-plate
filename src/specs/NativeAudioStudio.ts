import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for 8D Audio Studio's player module
 * (android/app/src/main/java/com/rnboilerplate/audiostudio/AudioStudioModule.kt).
 *
 * Only the audioStudio feature's service layer may import this file. Android
 * only: on iOS (and under Jest) the module is absent and `get` returns null.
 *
 * The player (Media3 ExoPlayer in a MediaSessionService) owns the queue, so
 * playback, the notification, lock-screen and headset controls keep working
 * while JS is paused. Every played sample goes through the native spatial
 * engine (android/spatialaudio) with the parameters from setDspParams.
 *
 * Song JSON: {id, uri, title, artist, album, albumId, genre, durationMs,
 * folder, dateAdded (ms), mimeType, size, artUri|null, source:'library'|'import'}.
 *
 * Event (DeviceEventEmitter) `AudioStudioEvent` {type, body: JSON}:
 *   state  {queue: string[] (song ids, in play order as shown), index,
 *           playing, buffering, positionMs, durationMs, repeat: 'off'|'one'|'all',
 *           shuffle, speed, sleepAt: number|null (epoch ms), sleepEndOfTrack,
 *           error: string|null}   — on every change (not per second)
 *   track  {id}                   — a song started playing (recently played)
 */
export interface Spec extends TurboModule {
  // ── library ──
  /** All audio files in MediaStore the app may read, as JSON Song[]. */
  scanLibrary(): Promise<string>;
  /** Songs for content:// URIs picked with the document picker (permission is persisted). JSON Song[]. */
  importFiles(uris: string[]): Promise<string>;

  // ── queue / playback ──
  /** Replaces the queue with JSON Song[] and prepares songs[startIndex] at positionMs. */
  setQueue(
    songsJson: string,
    startIndex: number,
    positionMs: number,
    play: boolean,
  ): void;
  /** Inserts JSON Song[] at index (−1 = end, −2 = right after the current song). */
  addToQueue(songsJson: string, index: number): void;
  removeFromQueue(index: number): void;
  moveQueueItem(from: number, to: number): void;
  /** Stops playback, empties the queue and ends the media notification. */
  clearQueue(): void;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seekTo(positionMs: number): void;
  skipTo(index: number): void;
  /** 'off' | 'one' | 'all' */
  setRepeatMode(mode: string): void;
  setShuffle(enabled: boolean): void;
  /** 0.5–2.0, pitch preserved. */
  setSpeed(speed: number): void;
  /** Pauses after `minutes` (0 = cancel), or at the end of the current song. */
  setSleepTimer(minutes: number, endOfTrack: boolean): void;
  /** Fade-out / fade-in between songs and on pause/resume, ms (0 = off). */
  setCrossfade(ms: number): void;
  /** Current state JSON (same shape as the `state` event body). */
  getState(): Promise<string>;

  // ── DSP ──
  /** The full engine parameter array (see src/features/audioStudio/dsp/params.ts). */
  setDspParams(params: number[]): void;
  /** [azimuth, elevation, distance, peakL, peakR, gainReductionDb] of the playing stream. */
  getDspState(): Promise<number[]>;

  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('AudioStudio');
