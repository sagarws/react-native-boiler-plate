import { DeviceEventEmitter } from 'react-native';
import NativeLiveCamera from '@/specs/NativeLiveCamera';
import type { NetworkState } from '../types';

/*
 * The live-camera native module (foreground service, notification, network
 * changes, QR, clipboard). Absent on iOS / under Jest: every call is then a
 * harmless no-op so the rest of the feature still runs.
 */

export type NativeEvent =
  | { type: 'stop' }
  | { type: 'network'; network: NetworkState };

const parseNetwork = (json: string): NetworkState | null => {
  try {
    const v = JSON.parse(json) as Partial<NetworkState>;
    return typeof v.online === 'boolean'
      ? { online: v.online, transport: v.transport ?? 'other' }
      : null;
  } catch {
    return null;
  }
};

export const liveNative = {
  available: !!NativeLiveCamera,

  async startService(title: string, withAudio: boolean): Promise<boolean> {
    if (!NativeLiveCamera) return false;
    try {
      await NativeLiveCamera.startService(title, withAudio);
      return true;
    } catch {
      return false;
    }
  },

  updateNotification(text: string): void {
    NativeLiveCamera?.updateNotification(text);
  },

  stopService(): void {
    NativeLiveCamera?.stopService();
  },

  async qrCode(text: string, size: number): Promise<string | null> {
    if (!NativeLiveCamera) return null;
    try {
      return await NativeLiveCamera.qrCode(text, size);
    } catch {
      return null;
    }
  },

  async copyText(text: string): Promise<boolean> {
    if (!NativeLiveCamera) return false;
    return NativeLiveCamera.copyText(text).catch(() => false);
  },

  async network(): Promise<NetworkState | null> {
    if (!NativeLiveCamera) return null;
    try {
      return parseNetwork(await NativeLiveCamera.getNetworkState());
    } catch {
      return null;
    }
  },

  onEvent(listener: (event: NativeEvent) => void): () => void {
    const sub = DeviceEventEmitter.addListener(
      'LiveCameraEvent',
      (e: { type?: string; body?: string }) => {
        if (e.type === 'stop') listener({ type: 'stop' });
        else if (e.type === 'network') {
          const network = parseNetwork(e.body ?? '');
          if (network) listener({ type: 'network', network });
        }
      },
    );
    return () => sub.remove();
  },
};
