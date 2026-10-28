import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/shared/components';
import { useTheme } from '@/theme';
import { lifeActions } from '../../hooks/useLife';
import { liveTasks } from '../../services/analytics';
import { currentState, streak } from '../../services/periods';
import { TaskCard } from '../TaskCard';
import type { TabProps } from './shared';

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * Today's targets with one-tap logging. Focus tasks first, then by priority;
 * this is also the in-app "quick entry" (there is no home-screen widget).
 */
export function TodayTab({ data, today, now, onLog, onOpenProject }: TabProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const input = { reports: data.reports, reviews: data.reviews, today };
  const rows = liveTasks(data)
    .map(task => ({ task, state: currentState(task, input) }))
    .filter(r => r.state && r.state.status === 'active')
    .sort((a, b) => {
      const fa = a.task.focusDay === today ? 0 : 1;
      const fb = b.task.focusDay === today ? 0 : 1;
      return (
        fa - fb ||
        PRIORITY_ORDER[a.task.priority] - PRIORITY_ORDER[b.task.priority] ||
        Number(a.state!.met) - Number(b.state!.met)
      );
    });

  if (!rows.length) {
    return (
      <EmptyState
        compact
        icon="circleCheck"
        title={t('life.nothingToday')}
        testID="today-empty"
      />
    );
  }
  const focus = rows.filter(r => r.task.focusDay === today);
  const rest = rows.filter(r => r.task.focusDay !== today);
  const heading = [typography.title, { color: colors.textPrimary }];

  const card = (r: (typeof rows)[number]) => (
    <TaskCard
      key={r.task.id}
      task={r.task}
      state={r.state}
      now={now}
      today={today}
      onLog={onLog}
      onOpen={x => onOpenProject(x.projectId)}
      onToggleFocus={x =>
        lifeActions.setFocus(x.id, x.focusDay === today ? null : today)
      }
      streak={streak(r.task, input)}
    />
  );

  return (
    <View style={{ gap: spacing.md }}>
      {focus.length ? (
        <>
          <Text style={heading}>{t('life.focusTitle')}</Text>
          {focus.map(card)}
        </>
      ) : null}
      <Text style={heading}>{t('life.todayTitle')}</Text>
      {rest.map(card)}
      <Text style={[typography.caption, { color: colors.textSecondary }]}>
        {t('life.widgetNote')}
      </Text>
    </View>
  );
}
