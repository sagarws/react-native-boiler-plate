import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FormField } from '@/features/life';
import { Button, Header, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import { useCountdownTimer } from '../hooks/useClock';
import { formatClock, splitMs, toMs } from '../services/clock';

/** Quick choices, in minutes. */
const PRESETS = [1, 3, 5, 10, 15, 30, 60];

const digits = (text: string, max: number) => {
  const n = parseInt(text.replace(/\D/g, '').slice(0, 2), 10);
  return Number.isFinite(n) ? Math.min(max, n) : 0;
};

/**
 * Countdown timer. Runs from a stored end time, so it keeps going when the
 * app is closed; an Android alarm shows "time's up" as a notification.
 */
export default function TimerScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const timer = useCountdownTimer();
  const { phase, state, remainingMs } = timer;
  const editable = phase === 'idle';
  const initial = splitMs(state.durationMs);
  const [h, setH] = useState(String(initial.h));
  const [m, setM] = useState(String(initial.m));
  const [s, setS] = useState(String(initial.s));

  const setFields = (ms: number) => {
    const p = splitMs(ms);
    setH(String(p.h));
    setM(String(p.m));
    setS(String(p.s));
    timer.setDuration(ms);
  };
  const onField = (which: 'h' | 'm' | 's', text: string) => {
    const next = {
      h: which === 'h' ? text : h,
      m: which === 'm' ? text : m,
      s: which === 's' ? text : s,
    };
    setH(next.h);
    setM(next.m);
    setS(next.s);
    timer.setDuration(
      toMs(digits(next.h, 99), digits(next.m, 59), digits(next.s, 59)),
    );
  };

  const progress =
    state.durationMs > 0 ? Math.min(1, remainingMs / state.durationMs) : 0;
  const finished = phase === 'finished';

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_timer')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <View
          style={[
            styles.face,
            {
              backgroundColor: finished ? colors.primarySoft : colors.card,
              borderColor: finished ? colors.primary : colors.border,
              borderRadius: radius.xl,
              paddingVertical: spacing.xl,
              gap: spacing.sm,
            },
          ]}
        >
          <Text
            testID="timer-time"
            accessibilityRole="timer"
            style={[
              typography.display,
              styles.time,
              { color: colors.textPrimary },
            ]}
          >
            {formatClock(remainingMs, false)}
          </Text>
          <Text
            testID="timer-phase"
            style={[
              typography.label,
              { color: finished ? colors.primaryText : colors.textSecondary },
            ]}
          >
            {t(`utility.timerPhase_${phase}`)}
          </Text>
          <View
            style={[
              styles.track,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: radius.pill,
              },
            ]}
          >
            <View
              style={[
                styles.fill,
                {
                  width: `${progress * 100}%`,
                  backgroundColor: colors.primary,
                  borderRadius: radius.pill,
                },
              ]}
            />
          </View>
        </View>

        {editable ? (
          <>
            <View style={[styles.row, { gap: spacing.sm }]}>
              {(
                [
                  ['h', h, 99],
                  ['m', m, 59],
                  ['s', s, 59],
                ] as const
              ).map(([key, value]) => (
                <View key={key} style={styles.flex}>
                  <FormField
                    label={t(`utility.timerField_${key}`)}
                    value={value}
                    onChangeText={text => onField(key, text)}
                    keyboardType="number-pad"
                    maxLength={2}
                    testID={`timer-${key}`}
                  />
                </View>
              ))}
            </View>
            <View style={[styles.wrap, { gap: spacing.xs }]}>
              {PRESETS.map(min => (
                <Pressable
                  key={min}
                  onPress={() => setFields(min * 60_000)}
                  accessibilityRole="button"
                  accessibilityLabel={t('utility.presetMinutes', {
                    count: min,
                  })}
                  testID={`timer-preset-${min}`}
                  style={[
                    styles.chip,
                    {
                      borderColor: colors.border,
                      borderRadius: radius.pill,
                      paddingHorizontal: spacing.md,
                    },
                    state.durationMs === min * 60_000 && {
                      backgroundColor: colors.primarySoft,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[typography.label, { color: colors.textPrimary }]}
                  >
                    {t('utility.presetShort', { count: min })}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            variant="secondary"
            iconName="rotateCcw"
            label={finished ? t('utility.timerDismiss') : t('utility.reset')}
            onPress={() => {
              timer.reset();
              setFields(state.durationMs);
            }}
            disabled={phase === 'idle'}
            style={styles.flex}
            testID="timer-reset"
          />
          {phase === 'running' ? (
            <Button
              variant="danger"
              iconName="pause"
              label={t('utility.pause')}
              onPress={timer.pause}
              style={styles.flex}
              testID="timer-pause"
            />
          ) : finished ? (
            <Button
              iconName="plus"
              label={t('utility.addMinute')}
              onPress={() => {
                void timer.addMinute();
              }}
              style={styles.flex}
              testID="timer-add"
            />
          ) : (
            <Button
              iconName="play"
              label={
                phase === 'paused' ? t('utility.resume') : t('utility.start')
              }
              onPress={() => {
                void timer.start();
              }}
              disabled={state.durationMs <= 0}
              style={styles.flex}
              testID="timer-start"
            />
          )}
        </View>
        {phase === 'running' ? (
          <Button
            variant="ghost"
            iconName="plus"
            label={t('utility.addMinute')}
            onPress={() => {
              void timer.addMinute();
            }}
            testID="timer-add-running"
          />
        ) : null}

        {timer.alarm === 'inexact' && phase === 'running' ? (
          <Notice
            tone="warning"
            message={t('utility.timerInexact')}
            action={{
              label: t('utility.allowExact'),
              onPress: timer.openExactSettings,
            }}
            testID="timer-inexact"
          />
        ) : null}
        {timer.alarm === 'no_notifications' && phase === 'running' ? (
          <Notice
            tone="warning"
            message={t('utility.timerNoNotifications')}
            testID="timer-no-notifications"
          />
        ) : null}
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('utility.timerHint')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  face: { borderWidth: 1, alignItems: 'center' },
  time: { fontVariant: ['tabular-nums'] },
  track: { width: '70%', height: 6, overflow: 'hidden' },
  fill: { height: 6 },
  row: { flexDirection: 'row' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
  chip: { borderWidth: 1, minHeight: 40, justifyContent: 'center' },
});
