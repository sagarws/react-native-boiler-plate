import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import { dayDetail, type DayMark } from '../../services/analytics';
import type { DayKey } from '../../types';
import { addDays, daysInMonth, monthStart } from '../../utils/dates';
import { formatLongDay, formatPeriod, formatQty } from '../../utils/format';
import { MonthCalendar } from '../MonthCalendar';
import { ProgressBar } from '../visuals';
import { ProjectChips } from './ProjectChips';
import type { TabProps } from './shared';

/**
 * Month view with a status dot per day (met / partial / missed / reason
 * needed; no dot = no target that day) and a day detail. Weekly and
 * every-N-days targets show their whole period, not a daily slice.
 */
export function CalendarTab({
  data,
  today,
  onLog,
  onReview,
  onOpenProject,
}: TabProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [month, setMonth] = useState<DayKey>(today);
  const [selected, setSelected] = useState<DayKey>(today);
  const [projectId, setProjectId] = useState<string | null>(null);

  const marks = useMemo(() => {
    const out: Record<DayKey, DayMark> = {};
    const first = monthStart(month);
    for (let i = 0; i < daysInMonth(first); i++) {
      const d = addDays(first, i);
      out[d] = dayDetail(data, d, today, projectId ?? undefined).mark;
    }
    return out;
  }, [data, month, today, projectId]);

  const detail = dayDetail(data, selected, today, projectId ?? undefined);
  const caption = [typography.caption, { color: colors.textSecondary }];
  const legend: DayMark[] = ['done', 'partial', 'missed', 'pending'];
  const legendColor: Record<string, string> = {
    done: colors.success,
    partial: colors.primary,
    missed: colors.error,
    pending: colors.warning,
  };

  return (
    <View style={{ gap: spacing.md }}>
      <ProjectChips
        projects={data.projects.filter(p => p.status === 'active')}
        value={projectId}
        onChange={setProjectId}
        testID="calendar-project"
      />
      <Card>
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={setSelected}
          today={today}
          marks={marks}
          testID="life-calendar"
        />
        <View
          style={[styles.legend, { gap: spacing.md, marginTop: spacing.sm }]}
        >
          {legend.map(m => (
            <View key={m} style={[styles.row, { gap: spacing.xs }]}>
              <View style={[styles.dot, { backgroundColor: legendColor[m] }]} />
              <Text style={caption}>{t(`life.legend_${m}`)}</Text>
            </View>
          ))}
          <View style={[styles.row, { gap: spacing.xs }]}>
            <View
              style={[
                styles.dot,
                styles.hollow,
                { borderColor: colors.textSecondary },
              ]}
            />
            <Text style={caption}>{t('life.legend_none')}</Text>
          </View>
        </View>
        <Button
          size="sm"
          variant="ghost"
          label={t('life.today')}
          onPress={() => {
            setMonth(today);
            setSelected(today);
          }}
          testID="calendar-today"
        />
      </Card>

      <Card testID="calendar-day">
        <Text
          style={[
            typography.title,
            { color: colors.textPrimary, marginBottom: spacing.sm },
          ]}
        >
          {formatLongDay(selected)}
        </Text>
        {detail.periods.length === 0 ? (
          <Text style={caption}>{t('life.dayEmpty')}</Text>
        ) : (
          detail.periods.map(s => {
            const notes = data.reports.filter(
              r =>
                r.taskId === s.task.id &&
                r.day >= s.start &&
                r.day <= s.end &&
                r.note,
            );
            return (
              <View
                key={`${s.task.id}-${s.start}`}
                style={[
                  styles.item,
                  {
                    borderTopColor: colors.divider,
                    paddingVertical: spacing.sm,
                    gap: spacing.xs,
                  },
                ]}
              >
                <Text
                  style={[typography.label, { color: colors.textPrimary }]}
                  onPress={() => onOpenProject(s.task.projectId)}
                >
                  {s.task.name}
                </Text>
                <Text style={caption}>
                  {t('life.periodOf', { range: formatPeriod(s.start, s.end) })}{' '}
                  ·{' '}
                  {s.status === 'active' && s.met
                    ? t('life.metLine')
                    : t(`life.status_${s.status}`)}
                  {!s.hasReports && s.status !== 'upcoming'
                    ? ` · ${t('life.notReported')}`
                    : ''}
                </Text>
                <Text style={[typography.body, { color: colors.textPrimary }]}>
                  {formatQty(s.completed)} / {formatQty(s.target.quantity)}{' '}
                  {s.task.unit} ({s.percent}%)
                </Text>
                <ProgressBar
                  percent={s.percent}
                  color={s.met ? colors.success : categoryColor(s.task.color)}
                />
                {notes.map(n => (
                  <Text key={n.id} style={caption}>
                    “{n.note}”
                  </Text>
                ))}
                {s.review ? (
                  <Text style={caption}>
                    {t(`life.reason_${s.review.reason}`)}
                    {s.review.note ? ` — ${s.review.note}` : ''}
                  </Text>
                ) : null}
                {s.status === 'active' ? (
                  <Button
                    size="sm"
                    variant="soft"
                    label={t('life.logProgress')}
                    onPress={() => onLog(s.task)}
                  />
                ) : null}
                {s.status === 'report_required' ? (
                  <Button
                    size="sm"
                    variant="soft"
                    label={t('life.giveReason')}
                    onPress={() => onReview(s)}
                    testID={`calendar-reason-${s.task.id}`}
                  />
                ) : null}
              </View>
            );
          })
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hollow: { borderWidth: 1 },
  item: { borderTopWidth: StyleSheet.hairlineWidth },
});
