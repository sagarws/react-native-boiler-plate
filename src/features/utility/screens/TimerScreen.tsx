import React from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import {
  Button,
  EmptyState,
  Header,
  Icon,
  Notice,
  StatusPill,
  type StatusTone,
} from '@/shared/components';
import { useTheme } from '@/theme';
import {
  BUILTIN_PRESET_MINUTES,
  useTimers,
  type TimerView,
} from '../hooks/useClock';
import { formatClock, type TimerPhase } from '../services/clock';
import { MAX_TIMERS, TIMER_ALERT } from '../store/clock.store';

const TONE: Record<TimerPhase, StatusTone> = {
  idle: 'neutral',
  running: 'success',
  paused: 'warning',
  finished: 'primary',
};

/**
 * Multiple Timer: up to 20 named timers that run independently, each with
 * its own alert (ringtone, volume, vibration). Each runs from a stored end
 * time and has its own Android alarm, so it alerts with the app closed and
 * one finishing never affects the others.
 */
export default function TimerScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const timers = useTimers();
  const full = timers.items.length >= MAX_TIMERS;

  const quickStart = async (minutes: number, name: string) => {
    const timer = await timers.add({
      name,
      durationMs: minutes * 60_000,
      alert: TIMER_ALERT,
    });
    if (timer) await timers.start(timer.id);
  };

  const confirmDelete = (x: TimerView) =>
    Alert.alert(t('utility.deleteNamedTitle', { name: x.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('utility.delete'),
        style: 'destructive',
        onPress: () => {
          void timers.remove(x.id);
        },
      },
    ]);

  const chip = (key: string, label: string, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      disabled={full}
      accessibilityRole="button"
      accessibilityLabel={t('utility.quickStart', { name: label })}
      testID={`timer-quick-${key}`}
      style={[
        styles.chip,
        {
          borderColor: colors.border,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
        },
        full && styles.dim,
      ]}
    >
      <Text style={[typography.label, { color: colors.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );

  const renderItem = ({ item: x }: { item: TimerView }) => {
    const finished = x.phase === 'finished';
    return (
      <View
        testID={`timer-${x.id}`}
        style={[
          styles.card,
          {
            backgroundColor: finished ? colors.primarySoft : colors.card,
            borderColor:
              x.phase === 'running' || finished
                ? colors.primary
                : colors.border,
            borderRadius: radius.lg,
            padding: spacing.md,
            gap: spacing.sm,
          },
        ]}
      >
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Text
            style={[
              typography.label,
              styles.flex,
              { color: colors.textPrimary },
            ]}
            numberOfLines={1}
          >
            {x.name}
          </Text>
          <StatusPill
            label={t(`utility.timerPhase_${x.phase}`)}
            tone={TONE[x.phase]}
            testID={`timer-phase-${x.id}`}
          />
          <Pressable
            onPress={() =>
              navigation.navigate(ROUTES.UTILITY_TIMER_EDIT, { timerId: x.id })
            }
            accessibilityRole="button"
            accessibilityLabel={t('utility.editNamed', { name: x.name })}
            hitSlop={8}
            testID={`timer-edit-${x.id}`}
          >
            <Icon name="pencil" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => confirmDelete(x)}
            accessibilityRole="button"
            accessibilityLabel={t('utility.deleteNamed', { name: x.name })}
            hitSlop={8}
            testID={`timer-delete-${x.id}`}
          >
            <Icon name="trash2" size={18} color={colors.error} />
          </Pressable>
        </View>
        <Text
          testID={`timer-time-${x.id}`}
          accessibilityRole="timer"
          style={[
            typography.display,
            styles.time,
            { color: colors.textPrimary },
          ]}
        >
          {formatClock(x.remaining, false)}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('utility.timerOf', {
            time: formatClock(x.durationMs, false),
            alert: t(`alarms.mode_${x.alert.mode}`),
          })}
        </Text>
        <View
          style={[
            styles.track,
            { backgroundColor: colors.surfaceMuted, borderRadius: radius.pill },
          ]}
        >
          <View
            style={[
              styles.fill,
              {
                width: `${Math.max(0, Math.min(1, x.progress)) * 100}%`,
                backgroundColor: colors.primary,
                borderRadius: radius.pill,
              },
            ]}
          />
        </View>
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            size="sm"
            variant="secondary"
            iconName="rotateCcw"
            label={finished ? t('utility.timerDismiss') : t('utility.reset')}
            onPress={() => {
              void timers.reset(x.id);
            }}
            disabled={x.phase === 'idle'}
            style={styles.flex}
            testID={`timer-reset-${x.id}`}
          />
          {x.phase === 'running' ? (
            <Button
              size="sm"
              variant="danger"
              iconName="pause"
              label={t('utility.pause')}
              onPress={() => {
                void timers.pause(x.id);
              }}
              style={styles.flex}
              testID={`timer-pause-${x.id}`}
            />
          ) : finished ? (
            <Button
              size="sm"
              iconName="plus"
              label={t('utility.addMinute')}
              onPress={() => {
                void timers.addMinute(x.id);
              }}
              style={styles.flex}
              testID={`timer-add-${x.id}`}
            />
          ) : (
            <Button
              size="sm"
              iconName="play"
              label={
                x.phase === 'paused' ? t('utility.resume') : t('utility.start')
              }
              onPress={() => {
                void timers.start(x.id);
              }}
              style={styles.flex}
              testID={`timer-start-${x.id}`}
            />
          )}
        </View>
      </View>
    );
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_timer')} />
      <FlatList
        data={timers.items}
        keyExtractor={x => x.id}
        renderItem={renderItem}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
        ListHeaderComponent={
          <View style={{ gap: spacing.sm }}>
            <Button
              iconName="plus"
              label={t('utility.newTimer')}
              onPress={() => navigation.navigate(ROUTES.UTILITY_TIMER_EDIT, {})}
              disabled={full}
              testID="timer-new"
            />
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('utility.quickStartTitle')}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.xs }}
            >
              {BUILTIN_PRESET_MINUTES.map(m =>
                chip(String(m), t('utility.presetShort', { count: m }), () => {
                  void quickStart(m, t('utility.presetShort', { count: m }));
                }),
              )}
              {timers.presets.map(p =>
                chip(
                  p.id,
                  `${p.name || formatClock(p.durationMs, false)}`,
                  () => {
                    void quickStart(
                      p.durationMs / 60_000,
                      p.name || formatClock(p.durationMs, false),
                    );
                  },
                ),
              )}
            </ScrollView>
            {full ? (
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t('utility.limitReached', { count: MAX_TIMERS })}
              </Text>
            ) : null}
            {timers.alarmState === 'inexact' ? (
              <Notice
                tone="warning"
                message={t('utility.timerInexact')}
                action={{
                  label: t('utility.allowExact'),
                  onPress: timers.openExactSettings,
                }}
                testID="timer-inexact"
              />
            ) : null}
            {timers.alarmState === 'no_notifications' ? (
              <Notice
                tone="warning"
                message={t('utility.timerNoNotifications')}
                testID="timer-no-notifications"
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="hourglass"
            title={t('utility.timerEmptyTitle')}
            message={t('utility.timerEmptyBody')}
            testID="timer-empty"
          />
        }
        ListFooterComponent={
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('utility.timerHint')}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  time: { fontVariant: ['tabular-nums'] },
  track: { height: 6, overflow: 'hidden' },
  fill: { height: 6 },
  chip: { borderWidth: 1, minHeight: 40, justifyContent: 'center' },
  dim: { opacity: 0.5 },
});
