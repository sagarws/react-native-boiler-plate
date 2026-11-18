import { useSyncExternalStore } from 'react';
import { logger } from '@/shared/utils';
import { networkRepository } from '../repository/network.repository';
import { networkSettingsStore } from '../store/networkSettings.store';
import type { NetworkSettings } from '../types';

export function useNetworkSettings(): NetworkSettings {
  return useSyncExternalStore(
    networkSettingsStore.subscribe,
    networkSettingsStore.read,
  );
}

/** Settings and session actions for the Network Inspector screens. */
export const networkActions = {
  setEnabled: networkSettingsStore.setEnabled,
  setSession: networkSettingsStore.setSession,
  addDomain: networkSettingsStore.addDomain,
  removeDomain: networkSettingsStore.removeDomain,
  setSubdomains: networkSettingsStore.setSubdomains,
  update: networkSettingsStore.update,
  clearRecords(): boolean {
    try {
      networkRepository.clear();
      return true;
    } catch (error) {
      logger.error('Network Inspector: clear failed', (error as Error)?.name);
      return false;
    }
  },
};
