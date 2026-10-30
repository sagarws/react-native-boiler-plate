import { DeviceEventEmitter } from 'react-native';
import NativeRecorder from '@/specs/NativeRecorder';
import { logger } from '@/shared/utils';
import type {
  DirectoryStatus,
  OutputKind,
  Recording,
  RecorderConfig,
  RecorderEvent,
  RecorderMode,
  RecorderStatus,
  VideoCapabilities,
} from '../recorder.types';
import {
  DEFAULT_RECORDER_CONFIG,
  parseCapabilities,
  parseConfig,
  parseDirectories,
  parseDirectory,
  parseRecording,
  parseRecordings,
  parseStatus,
  UNSUPPORTED_STATUS,
} from './recordings';
import { UtilityError } from './native.service';

const errorCode = (error: unknown) =>
  (error as { code?: string })?.code || (error as Error)?.message || 'failed';

function need() {
  if (!NativeRecorder) throw new UtilityError('unavailable');
  return NativeRecorder;
}

/** '#RRGGBB' → signed 32-bit ARGB (Android colour int); null if not a hex colour. */
export function hexToArgb(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  // Opaque alpha (0xFF…) as a signed Java int: 0xFF000000 − 2³² = −0x1000000.
  return parseInt(m[1], 16) - 0x1000000;
}

export type BubbleOutcome = 'shown' | 'hidden' | 'overlay_permission';

/**
 * The Screen Recorder's bridge to Android. Capture, segmenting and merging
 * run natively in RecorderService; this only sends commands and reads
 * state/library JSON. Recordings never leave the device and their contents
 * are never logged.
 */
export const recorderNative = {
  available: (): boolean => NativeRecorder != null,

  async status(): Promise<RecorderStatus> {
    if (!NativeRecorder) return UNSUPPORTED_STATUS;
    try {
      return parseStatus(await NativeRecorder.getStatus());
    } catch (error) {
      logger.warn('recorder status failed', errorCode(error));
      return UNSUPPORTED_STATUS;
    }
  },

  async config(): Promise<RecorderConfig> {
    if (!NativeRecorder) return DEFAULT_RECORDER_CONFIG;
    return parseConfig(await NativeRecorder.getConfig());
  },

  async updateConfig(patch: Partial<RecorderConfig>): Promise<RecorderConfig> {
    try {
      return parseConfig(await need().updateConfig(JSON.stringify(patch)));
    } catch (error) {
      logger.warn('recorder config update failed', errorCode(error));
      throw new UtilityError(errorCode(error));
    }
  },

  /** The overlay (button, menu, preview) follows the app's light/dark theme and accent. */
  syncTheme(dark: boolean, accentHex: string) {
    if (!NativeRecorder) return;
    const accentColor = hexToArgb(accentHex);
    const patch: Record<string, unknown> = { dark };
    if (accentColor !== null) patch.accentColor = accentColor;
    NativeRecorder.updateConfig(JSON.stringify(patch)).catch(error =>
      logger.warn('recorder theme sync failed', errorCode(error)),
    );
  },

  async setBubbleEnabled(enabled: boolean): Promise<BubbleOutcome> {
    return (await need().setBubbleEnabled(enabled)) as BubbleOutcome;
  },
  openOverlaySettings() {
    NativeRecorder?.openOverlaySettings();
  },
  resetBubblePosition() {
    NativeRecorder?.resetBubblePosition();
  },
  run(mode: RecorderMode) {
    need().runAction(mode);
  },
  stop() {
    NativeRecorder?.stopRecording();
  },
  pauseResume() {
    NativeRecorder?.pauseResume();
  },
  endCapture() {
    NativeRecorder?.endCapture();
  },

  // ── Library ──
  async recordings(): Promise<Recording[]> {
    if (!NativeRecorder) return [];
    return parseRecordings(await NativeRecorder.listRecordings());
  },
  async rename(id: string, name: string): Promise<Recording | null> {
    try {
      return parseRecording(JSON.parse(await need().renameRecording(id, name)));
    } catch (error) {
      throw new UtilityError(errorCode(error));
    }
  },
  async remove(id: string): Promise<boolean> {
    try {
      return await need().deleteRecording(id);
    } catch (error) {
      throw new UtilityError(errorCode(error));
    }
  },
  remerge(id: string) {
    need().remerge(id);
  },
  async open(id: string): Promise<boolean> {
    return NativeRecorder ? NativeRecorder.openRecording(id) : false;
  },
  async openSegment(id: string, index: number): Promise<boolean> {
    return NativeRecorder ? NativeRecorder.openSegment(id, index) : false;
  },
  async share(id: string): Promise<boolean> {
    return NativeRecorder ? NativeRecorder.shareRecording(id) : false;
  },
  async edit(id: string): Promise<boolean> {
    return NativeRecorder ? NativeRecorder.editScreenshot(id) : false;
  },

  // ── Storage & quality ──
  async directories(): Promise<Partial<Record<OutputKind, DirectoryStatus>>> {
    if (!NativeRecorder) return {};
    return parseDirectories(await NativeRecorder.getDirectories());
  },
  /** null = the user cancelled the picker. */
  async pickDirectory(kind: OutputKind): Promise<DirectoryStatus | null> {
    try {
      const json = await need().pickDirectory(kind);
      return json ? parseDirectory(JSON.parse(json)) : null;
    } catch (error) {
      logger.warn('recorder folder pick failed', errorCode(error));
      throw new UtilityError(errorCode(error));
    }
  },
  async clearDirectory(kind: OutputKind): Promise<boolean> {
    return NativeRecorder ? NativeRecorder.clearDirectory(kind) : false;
  },
  async testDirectory(kind: OutputKind): Promise<boolean> {
    return NativeRecorder ? NativeRecorder.testDirectory(kind) : false;
  },
  async capabilities(): Promise<VideoCapabilities | null> {
    if (!NativeRecorder) return null;
    try {
      return parseCapabilities(await NativeRecorder.getVideoCapabilities());
    } catch (error) {
      logger.warn('recorder capabilities failed', errorCode(error));
      return null;
    }
  },

  /** Native state/progress events; returns an unsubscribe. */
  onEvent(listener: (event: RecorderEvent) => void): () => void {
    const sub = DeviceEventEmitter.addListener(
      'RecorderEvent',
      (e: { type?: string; body?: string }) => {
        let body: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(e?.body ?? '{}');
          if (parsed && typeof parsed === 'object')
            body = parsed as Record<string, unknown>;
        } catch {
          body = {};
        }
        listener({ type: e?.type ?? '', body });
      },
    );
    return () => sub.remove();
  },
};
