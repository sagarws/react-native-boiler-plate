import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import { lifeWidgetService } from '@/features/capture';
import { lifeStore } from '../store/life.store';
import {
  buildWidgetSnapshot,
  importWidgetLogs,
  type WidgetLabels,
} from '../services/widget';
import { todayKey } from '../utils/dates';

const PUSH_DELAY_MS = 300;

/**
 * Keeps the home-screen widget in step with Manage Life: on launch and every
 * return to the foreground it imports the widget's queued quick logs, and it
 * pushes a fresh snapshot after every change. Mounted once at the app root.
 */
export function useLifeWidgetSync(): void {
  const { t } = useTranslation();

  useEffect(() => {
    const labels: WidgetLabels = {
      title: t('life.widget_title'),
      empty: t('life.widget_empty'),
      setup: t('life.widget_setup'),
      met: t('life.metLine'),
      endsToday: t('life.widget_endsToday'),
      endsOn: t('life.widget_endsOn', { date: '%s' }),
      stale: t('life.widget_stale'),
      more: t('life.widget_more', { count: '%d' }),
    };
    const push = () =>
      lifeWidgetService.push(
        buildWidgetSnapshot(lifeStore.read(), todayKey(), labels),
      );
    let busy = false;
    const sync = async () => {
      if (busy) return;
      busy = true;
      const logs = await lifeWidgetService.takeLogs();
      if (logs.length) importWidgetLogs(logs, todayKey());
      busy = false;
      push();
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = lifeStore.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(push, PUSH_DELAY_MS);
    });
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void sync();
    });
    void sync();
    return () => {
      clearTimeout(timer);
      unsubscribe();
      sub.remove();
    };
  }, [t]);
}
