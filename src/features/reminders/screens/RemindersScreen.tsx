import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MonthCalendar } from '@/features/life';
import { ROUTES } from '@/navigation/routes';
import {
  Button,
  Card,
  EmptyState,
  Header,
  Icon,
  Notice,
  SegmentedControl,
} from '@/shared/components';
import { requestNotificationPermission } from '@/shared/utils/permissions';
import { addDays, todayKey, type DayKey } from '@/shared/utils/dayKey';
import { categoryColor, useTheme } from '@/theme';
import { ReminderRow } from '../components/ReminderRow';
import {
  reminderActions,
  syncReminderAlarms,
  useAlarmState,
  useNowMs,
  useRemindersData,
} from '../hooks/useReminders';
import { monthDots, onDay, views } from '../services/reminders';
import { CATEGORY_COLOR, CATEGORY_ICON, HIGHLIGHT } from '../types';
import { formatIn, formatWhen } from '../utils/format';

type List = 'upcoming' | 'past' | 'off';
const LISTS: readonly List[] = ['upcoming', 'past', 'off'];

const inText = (t: TFunction, p: { d: number; h: number; m: number }) =>
  p.d
    ? t('reminders.inDays', p)
    : p.h
    ? t('reminders.inHours', p)
    : t('reminders.inMinutes', p);

const daysIn = (first: DayKey) => {
  const [y, m] = first.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

/**
 * Reminders dashboard: the next reminder, a month calendar with a dot per
 * reminder (birthdays and important events first), the selected day's
 * reminders, and upcoming / past / off lists.
 */
export default function RemindersScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const reminders = useRemindersData();
  const now = useNowMs();
  const alarmState = useAlarmState();
  const today = todayKey(new Date(now));
  const [month, setMonth] = useState<DayKey>(today);
  const [selected, setSelected] = useState<DayKey>(today);
  const [list, setList] = useState<List>('upcoming');

  const v = useMemo(() => views(reminders, now), [reminders, now]);
  const first = `${month.slice(0, 7)}-01`;
  const dots = useMemo(
    () => monthDots(reminders, first, daysIn(first), categoryColor),
    [reminders, first],
  );
  const dayItems = onDay(reminders, selected);
  const next = v.upcoming[0];

  const open = (id?: string, date?: DayKey) =>
    navigation.navigate(ROUTES.REMINDER_FORM, { reminderId: id, date });

  const rows =
    list === 'upcoming'
      ? v.upcoming
      : list === 'past'
      ? v.past
      : v.off.map(r => ({ reminder: r, at: null }));

  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('reminders.title')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {alarmState.kind === 'blocked' ? (
          <Notice
            tone="warning"
            message={t('reminders.notificationsOff')}
            action={{
              label: t('reminders.allow'),
              onPress: async () => {
                await requestNotificationPermission();
                await syncReminderAlarms(t);
              },
            }}
            testID="reminders-blocked"
          />
        ) : null}
        {alarmState.kind === 'ok' && !alarmState.exact && v.upcoming.length ? (
          <Notice
            tone="warning"
            message={t('reminders.inexact')}
            action={{
              label: t('reminders.allowExact'),
              onPress: reminderActions.openExactSettings,
            }}
            testID="reminders-inexact"
          />
        ) : null}
        {alarmState.kind === 'unavailable' || alarmState.kind === 'failed' ? (
          <Notice
            tone="error"
            message={t(`reminders.alarm_${alarmState.kind}`)}
            testID="reminders-alarm-error"
          />
        ) : null}

        {next ? (
          <Card testID="reminders-next">
            <View style={[styles.row, { gap: spacing.md }]}>
              <View
                style={[
                  styles.bigIcon,
                  {
                    backgroundColor: categoryColor(
                      CATEGORY_COLOR[next.reminder.category],
                    ),
                    borderRadius: radius.lg,
                  },
                ]}
              >
                <Icon
                  name={CATEGORY_ICON[next.reminder.category]}
                  size={26}
                  color={colors.primaryForeground}
                />
              </View>
              <View style={styles.flex}>
                <Text style={caption}>{t('reminders.nextUp')}</Text>
                <Text
                  style={[typography.title, { color: colors.textPrimary }]}
                  numberOfLines={2}
                >
                  {next.reminder.title}
                </Text>
                <Text style={caption}>
                  {formatWhen(next.at)} · {inText(t, formatIn(next.at - now))}
                </Text>
                {HIGHLIGHT.includes(next.reminder.category) ? (
                  <Text
                    style={[
                      typography.label,
                      {
                        color: categoryColor(
                          CATEGORY_COLOR[next.reminder.category],
                        ),
                      },
                    ]}
                  >
                    {t(`reminders.category_${next.reminder.category}`)}
                  </Text>
                ) : null}
              </View>
            </View>
          </Card>
        ) : null}

        <Button
          iconName="plus"
          label={t('reminders.new')}
          onPress={() => open(undefined, selected >= today ? selected : today)}
          testID="reminders-new"
        />

        <Card>
          <MonthCalendar
            month={month}
            onMonthChange={setMonth}
            selected={selected}
            onSelect={setSelected}
            today={today}
            dots={dots}
            testID="reminders-calendar"
          />
          <View
            style={[styles.wrap, { gap: spacing.md, marginTop: spacing.sm }]}
          >
            {(['birthday', 'important', 'meeting', 'personal'] as const).map(
              c => (
                <View key={c} style={[styles.row, { gap: spacing.xs }]}>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: categoryColor(CATEGORY_COLOR[c]) },
                    ]}
                  />
                  <Text style={caption}>{t(`reminders.category_${c}`)}</Text>
                </View>
              ),
            )}
          </View>
        </Card>

        <Card testID="reminders-day">
          <Text
            style={[
              typography.title,
              { color: colors.textPrimary, marginBottom: spacing.sm },
            ]}
          >
            {selected === today
              ? t('reminders.today')
              : selected === addDays(today, 1)
              ? t('reminders.tomorrow')
              : new Date(`${selected}T12:00:00`).toLocaleDateString([], {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
          </Text>
          {dayItems.length === 0 ? (
            <Text style={caption} testID="reminders-day-empty">
              {t('reminders.dayEmpty')}
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {dayItems.map(({ reminder, at }) => (
                <ReminderRow
                  key={reminder.id}
                  reminder={reminder}
                  at={at}
                  onPress={() => open(reminder.id)}
                />
              ))}
            </View>
          )}
        </Card>

        <SegmentedControl
          options={LISTS.map(l => ({
            value: l,
            label: t(`reminders.list_${l}`, {
              count:
                l === 'upcoming'
                  ? v.upcoming.length
                  : l === 'past'
                  ? v.past.length
                  : v.off.length,
            }),
          }))}
          value={list}
          onChange={setList}
          accessibilityLabel={t('reminders.lists')}
          testID="reminders-list"
        />
        {rows.length === 0 ? (
          <EmptyState
            compact
            icon="bell"
            title={t(`reminders.empty_${list}`)}
            testID={`reminders-empty-${list}`}
          />
        ) : (
          rows.map(({ reminder, at }) => (
            <ReminderRow
              key={reminder.id}
              reminder={reminder}
              at={at}
              onPress={() => open(reminder.id)}
              onToggle={
                list === 'past'
                  ? undefined
                  : enabled => reminderActions.setEnabled(reminder.id, enabled)
              }
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 0 },
  bigIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
