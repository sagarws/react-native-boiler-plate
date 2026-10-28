import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import { lifeStore } from '../store/life.store';
import { describeTarget } from '../services/periods';
import type { DayKey, LifeData, TargetVersion } from '../types';
import { todayKey } from '../utils/dates';

/** All Manage Life records, re-rendering on every change. */
export function useLifeData(): LifeData {
  return useSyncExternalStore(lifeStore.subscribe, lifeStore.read);
}

const TICK_MS = 30_000;

/**
 * "Now" for countdowns and period boundaries: refreshed every 30 s and when
 * the app returns to the foreground (so a day change while closed, or a
 * timezone change, is picked up on reopen).
 */
export function useClock(): { now: Date; today: DayKey } {
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
  return { now, today: todayKey(now) };
}

/** "30 minutes every day" in the user's language. */
export function useDescribeTarget() {
  const { t } = useTranslation();
  return useCallback(
    (
      target: Pick<TargetVersion, 'quantity' | 'frequency' | 'intervalDays'>,
      unit: string,
    ) =>
      describeTarget(target, unit, {
        everyDay: t('life.everyDay'),
        everyWeek: t('life.everyWeek'),
        everyNDays: n => t('life.everyNDays', { count: n }),
      }),
    [t],
  );
}

/** Store mutations for screens (the hook layer between UI and persistence). */
export const lifeActions = {
  createProject: lifeStore.createProject,
  updateProject: lifeStore.updateProject,
  setProjectStatus: lifeStore.setProjectStatus,
  deleteProject: lifeStore.deleteProject,
  createTask: lifeStore.createTask,
  updateTask: lifeStore.updateTask,
  changeTarget: lifeStore.changeTarget,
  setTaskStatus: lifeStore.setTaskStatus,
  pauseTask: lifeStore.pauseTask,
  resumeTask: lifeStore.resumeTask,
  setFocus: lifeStore.setFocus,
  deleteTask: lifeStore.deleteTask,
  addReport: lifeStore.addReport,
  editReport: lifeStore.editReport,
  deleteReport: lifeStore.deleteReport,
  addReview: lifeStore.addReview,
  updateReview: lifeStore.updateReview,
};
