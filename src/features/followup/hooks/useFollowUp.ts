import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { followUpStore } from '../store/followup.store';
import type { FollowUpData } from '../types';

/** All Follow Up records, re-rendering on every change. */
export function useFollowUpData(): FollowUpData {
  return useSyncExternalStore(followUpStore.subscribe, followUpStore.read);
}

const TICK_MS = 30_000;

/**
 * "Now" for due/overdue status: refreshed every 30 s and when the app
 * returns to the foreground (so a day change while closed is picked up).
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, TICK_MS);
    const sub = AppState.addEventListener(
      'change',
      state => state === 'active' && tick(),
    );
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  return now;
}

/** Store mutations for screens (the hook layer between UI and persistence). */
export const followUpActions = {
  findDuplicate: followUpStore.findDuplicate,
  createContact: followUpStore.createContact,
  updateContact: followUpStore.updateContact,
  setContactActive: followUpStore.setContactActive,
  deleteContact: followUpStore.deleteContact,
  schedule: followUpStore.schedule,
  editFollowUp: followUpStore.editFollowUp,
  setCancelled: followUpStore.setCancelled,
  deleteFollowUp: followUpStore.deleteFollowUp,
  complete: followUpStore.complete,
  addNote: followUpStore.addNote,
  deleteNote: followUpStore.deleteNote,
  saveCategory: followUpStore.saveCategory,
  setCategoryActive: followUpStore.setCategoryActive,
  deleteCategory: followUpStore.deleteCategory,
  saveTag: followUpStore.saveTag,
  setTagActive: followUpStore.setTagActive,
  deleteTag: followUpStore.deleteTag,
  addSuggestions: followUpStore.addSuggestions,
  updateSettings: followUpStore.updateSettings,
  deleteAll: followUpStore.deleteAll,
};
