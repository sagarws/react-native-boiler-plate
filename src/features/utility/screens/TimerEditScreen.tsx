import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainStackParamList } from '@/navigation/types';
import { FormField } from '@/features/life';
import { AlertSettings, Button, Header, Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import { BUILTIN_PRESET_MINUTES, useTimers } from '../hooks/useClock';
import { formatClock, splitMs, toMs } from '../services/clock';
import { TIMER_ALERT } from '../store/clock.store';

const digits = (text: string, max: number) => {
  const n = parseInt(text.replace(/\D/g, '').slice(0, 2), 10);
  return Number.isFinite(n) ? Math.min(max, n) : 0;
};

/**
 * Create or edit one timer: name, hours / minutes / seconds (or a preset),
 * and its own alert — mode, ringtone, volume and vibration. Durations can be
 * saved as presets for next time.
 */
export default function TimerEditScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'UtilityTimerEdit'>>();
  const timers = useTimers();
  const existing = timers.items.find(x => x.id === params?.timerId);
  const initial = splitMs(existing?.durationMs ?? 5 * 60_000);
  const [name, setName] = useState(existing?.name ?? '');
  const [h, setH] = useState(String(initial.h));
  const [m, setM] = useState(String(initial.m));
  const [s, setS] = useState(String(initial.s));
  const [alert, setAlert] = useState(existing?.alert ?? TIMER_ALERT);
  const duration = toMs(digits(h, 99), digits(m, 59), digits(s, 59));
  const valid = duration > 0;

  const setDuration = (ms: number) => {
    const p = splitMs(ms);
    setH(String(p.h));
    setM(String(p.m));
    setS(String(p.s));
  };

  const save = async (start: boolean) => {
    if (!valid) return;
    const input = {
      name: name.trim() || formatClock(duration, false),
      durationMs: duration,
      alert,
    };
    if (existing) {
      await timers.edit(existing.id, input);
    } else {
      const created = await timers.add(input);
      if (created && start) await timers.start(created.id);
    }
    navigation.goBack();
  };

  const chip = (
    key: string,
    label: string,
    ms: number,
    onLongPress?: () => void,
  ) => (
    <Pressable
      key={key}
      onPress={() => setDuration(ms)}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected: duration === ms }}
      accessibilityHint={
        onLongPress ? t('utility.presetDeleteHint') : undefined
      }
      testID={`timer-preset-${key}`}
      style={[
        styles.chip,
        {
          borderColor: duration === ms ? colors.primary : colors.border,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
        },
        duration === ms && { backgroundColor: colors.primarySoft },
      ]}
    >
      <Text style={[typography.label, { color: colors.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header
        label={existing ? t('utility.editTimer') : t('utility.newTimer')}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <FormField
          label={t('utility.name')}
          placeholder={t('utility.timerNamePlaceholder')}
          value={name}
          onChangeText={setName}
          maxLength={40}
          testID="timer-name"
        />
        <View style={[styles.row, { gap: spacing.sm }]}>
          {(
            [
              ['h', h, setH],
              ['m', m, setM],
              ['s', s, setS],
            ] as const
          ).map(([key, value, set]) => (
            <View key={key} style={styles.flex}>
              <FormField
                label={t(`utility.timerField_${key}`)}
                value={value}
                onChangeText={set}
                keyboardType="number-pad"
                maxLength={2}
                testID={`timer-${key}`}
              />
            </View>
          ))}
        </View>
        {!valid ? (
          <Text style={[typography.caption, { color: colors.error }]}>
            {t('utility.timerZero')}
          </Text>
        ) : null}
        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {t('utility.presets')}
        </Text>
        <View style={[styles.wrap, { gap: spacing.xs }]}>
          {BUILTIN_PRESET_MINUTES.map(min =>
            chip(
              String(min),
              t('utility.presetShort', { count: min }),
              min * 60_000,
            ),
          )}
          {timers.presets.map(p =>
            chip(
              p.id,
              p.name
                ? `${p.name} · ${formatClock(p.durationMs, false)}`
                : formatClock(p.durationMs, false),
              p.durationMs,
              () =>
                Alert.alert(t('utility.presetDeleteTitle'), undefined, [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('utility.delete'),
                    style: 'destructive',
                    onPress: () => timers.deletePreset(p.id),
                  },
                ]),
            ),
          )}
        </View>
        <Pressable
          onPress={() => {
            if (valid) timers.savePreset(name, duration);
          }}
          disabled={!valid}
          accessibilityRole="button"
          style={[styles.row, { gap: spacing.xs }]}
          testID="timer-save-preset"
        >
          <Icon name="plus" size={16} color={colors.primaryText} />
          <Text style={[typography.label, { color: colors.primaryText }]}>
            {t('utility.savePreset', { time: formatClock(duration, false) })}
          </Text>
        </Pressable>

        <Text
          style={[
            typography.title,
            { color: colors.textPrimary, marginTop: spacing.md },
          ]}
        >
          {t('utility.timerAlert')}
        </Text>
        <AlertSettings
          value={alert}
          onChange={setAlert}
          showSnooze={false}
          testID="timer-alert"
        />

        <Button
          label={existing ? t('utility.save') : t('utility.saveAndStart')}
          iconName={existing ? 'check' : 'play'}
          onPress={() => {
            void save(!existing);
          }}
          disabled={!valid}
          testID="timer-save"
        />
        {!existing ? (
          <Button
            variant="secondary"
            label={t('utility.save')}
            onPress={() => {
              void save(false);
            }}
            disabled={!valid}
            testID="timer-save-only"
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
  chip: { borderWidth: 1, minHeight: 40, justifyContent: 'center' },
});
