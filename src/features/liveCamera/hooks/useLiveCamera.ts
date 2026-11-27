import { useEffect, useState, useSyncExternalStore } from 'react';
import { liveCameraService } from '../services/liveCamera.service';
import { liveNative } from '../services/native.service';
import { liveCameraSettingsStore } from '../store/liveCameraSettings.store';
import type { LiveCameraSettings, LiveCameraState } from '../types';

export const useLiveCamera = (): LiveCameraState =>
  useSyncExternalStore(
    liveCameraService.subscribe,
    () => liveCameraService.snapshot,
  );

export const useLiveCameraSettings = (): LiveCameraSettings =>
  useSyncExternalStore(
    liveCameraSettingsStore.subscribe,
    liveCameraSettingsStore.read,
  );

/** Seconds since `since`, ticking once a second (null when not live). */
export const useElapsed = (since: number | null): number | null => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : null;
};

/** QR code PNG for `text` (null while generating / without a link). */
export const useQrCode = (text: string | null, size = 640): string | null => {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUri(null);
    if (text) liveNative.qrCode(text, size).then(u => live && setUri(u));
    return () => {
      live = false;
    };
  }, [text, size]);
  return uri;
};

export const liveCameraActions = {
  openPreview: () => liveCameraService.openPreview(),
  closePreview: () => liveCameraService.closePreview(),
  switchCamera: () => liveCameraService.switchCamera(),
  start: () => liveCameraService.start(),
  stop: () => liveCameraService.stop(),
  regenerateLink: () => liveCameraService.regenerateLink(),
  revokeLink: () => liveCameraService.revokeLink(),
  setPassword: (p: string) => liveCameraService.setPassword(p),
  password: () => liveCameraService.currentPassword,
  clearError: () => liveCameraService.clearError(),
  testServer: (url: string) => liveCameraService.testServer(url),
  copy: (text: string) => liveNative.copyText(text),
  /** Saves settings; camera ones re-open the camera, stream ones go to the server. */
  async updateSettings(patch: Partial<LiveCameraSettings>): Promise<void> {
    const before = liveCameraSettingsStore.read();
    const next = liveCameraSettingsStore.update(patch);
    if (
      before.resolution !== next.resolution ||
      before.fps !== next.fps ||
      before.audio !== next.audio
    )
      await liveCameraService.applyCameraSettings();
    if (
      before.title !== next.title ||
      before.access !== next.access ||
      before.maxViewers !== next.maxViewers
    )
      await liveCameraService.pushSettings(next);
  },
  /** Re-sends the (new) password while live. */
  pushPassword: () =>
    liveCameraService.pushSettings(liveCameraSettingsStore.read()),
};
