import { useEffect, useState, useSyncExternalStore } from 'react';
import { remoteService, type RemoteState } from '../services/remote.service';
import { remoteSettingsStore } from '../store/remoteSettings.store';
import type { QualityPreset, RemoteSettings } from '../types';

/** Everything Remote Access shows: identity, devices, the sessions. */
export function useRemoteState(): RemoteState {
  return useSyncExternalStore(remoteService.subscribe, remoteService.getState);
}

export function useRemoteSettings(): RemoteSettings {
  return useSyncExternalStore(
    remoteSettingsStore.subscribe,
    remoteSettingsStore.read,
  );
}

export const updateRemoteSettings = (patch: Partial<RemoteSettings>): void => {
  remoteSettingsStore.update(patch);
};

/** Re-renders every second while `active` (countdowns). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Actions for the screens; the service does the work. */
export const remoteActions = {
  start: () => remoteService.start(),
  connect: (
    target: string,
    password?: string,
    options?: { remember?: boolean; useSaved?: boolean },
  ) => remoteService.connect(target, password, options),
  reconnect: (id: string) => remoteService.reconnect(id),
  forgetSavedPassword: (id: string) => remoteService.forgetSavedPassword(id),
  forgetAllSavedPasswords: () => remoteService.forgetAllSavedPasswords(),
  cancelConnect: () => remoteService.cancelConnect(),
  clearConnectError: () => remoteService.clearConnectError(),
  refresh: () => remoteService.refreshDevices(),
  disconnect: () => remoteService.disconnect(),
  dismissViewer: () => remoteService.dismissViewer(),
  setQuality: (preset: QualityPreset) => remoteService.setQuality(preset),
  viewer: () => remoteService.currentViewer(),
  updateDevice: remoteService.updateDevice.bind(remoteService),
  removeDevice: remoteService.removeDevice.bind(remoteService),
  clearHistory: () => remoteService.clearHistory(),
  host: () => remoteService.hostService(),
};
