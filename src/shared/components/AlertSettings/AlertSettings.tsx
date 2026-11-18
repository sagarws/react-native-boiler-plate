import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  ALERT_MODES,
  SNOOZE_CHOICES,
  VIBRATION_PATTERNS,
  alarms,
  type AlertConfig,
} from '@/services/alarms';
import { useTheme } from '@/theme';
import { Button } from '../Button';
import { ChoiceList } from '../ChoiceList';
import { Notice } from '../Notice';
import { SegmentedControl } from '../SegmentedControl';
import { Slider } from '../Slider';

export interface AlertSettingsProps {
  value: AlertConfig;
  onChange: (next: AlertConfig) => void;
  /** Hide snooze for alerts where it makes no sense. */
  showSnooze?: boolean;
  testID: string;
}

const HAS_SOUND = new Set(['sound', 'both', 'priority']);
const HAS_VIBRATION = new Set(['vibrate', 'both', 'priority']);

/**
 * How a scheduled alarm alerts — used by Reminders and Utility's timers:
 * alert mode, ringtone (system picker + preview), volume, vibration pattern
 * and snooze. Volume is relative to the phone's alarm volume, which the app
 * never changes; high priority does not bypass Do Not Disturb.
 */
export function AlertSettings({
  value,
  onChange,
  showSnooze = true,
  testID,
}: AlertSettingsProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [previewing, setPreviewing] = useState(false);
  const [fullScreen, setFullScreen] = useState(true);
  const [vibrator, setVibrator] = useState(true);
  const set = (patch: Partial<AlertConfig>) => onChange({ ...value, ...patch });
  const sound = HAS_SOUND.has(value.mode);
  const vibration = HAS_VIBRATION.has(value.mode);

  useEffect(() => {
    alarms.canUseFullScreen().then(setFullScreen, () => setFullScreen(true));
    alarms.hasVibrator().then(setVibrator, () => setVibrator(true));
    return () => alarms.stopPreview();
  }, []);

  const preview = async () => {
    if (previewing) {
      alarms.stopPreview();
      setPreviewing(false);
      return;
    }
    const ok = await alarms.preview(value.ringtone, value.volume);
    setPreviewing(ok);
    // The native preview stops itself after a few seconds.
    if (ok) setTimeout(() => setPreviewing(false), 6000);
  };

  const label = [typography.label, { color: colors.textPrimary }];
  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <View style={{ gap: spacing.md }} testID={testID}>
      <Text style={label}>{t('alarms.mode')}</Text>
      <ChoiceList
        choices={ALERT_MODES.map(m => ({
          value: m,
          title: t(`alarms.mode_${m}`),
          description: t(`alarms.modeDesc_${m}`),
        }))}
        value={value.mode}
        onChange={mode => set({ mode })}
        accessibilityLabel={t('alarms.mode')}
        testID={`${testID}-mode`}
      />
      {value.mode === 'priority' && !fullScreen ? (
        <Notice
          tone="warning"
          message={t('alarms.fullScreenOff')}
          action={{
            label: t('alarms.allow'),
            onPress: alarms.openFullScreenSettings,
          }}
        />
      ) : null}
      {vibration && !vibrator ? (
        <Notice tone="info" message={t('alarms.noVibrator')} />
      ) : null}

      {sound ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={label}>{t('alarms.ringtone')}</Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {value.ringtoneTitle || t('alarms.defaultRingtone')}
          </Text>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Button
              size="sm"
              variant="secondary"
              iconName="bell"
              label={t('alarms.chooseRingtone')}
              onPress={async () => {
                alarms.stopPreview();
                setPreviewing(false);
                const r = await alarms.pickRingtone(value.ringtone);
                if (r)
                  set({ ringtone: r.uri, ringtoneTitle: r.uri ? r.title : '' });
              }}
              testID={`${testID}-ringtone`}
            />
            <Button
              size="sm"
              variant="ghost"
              iconName={previewing ? 'square' : 'play'}
              label={previewing ? t('alarms.stopPreview') : t('alarms.preview')}
              onPress={() => {
                void preview();
              }}
              testID={`${testID}-preview`}
            />
          </View>
          <Text style={label}>
            {t('alarms.volume', {
              percent: value.mode === 'priority' ? 100 : value.volume,
            })}
          </Text>
          <Slider
            value={value.mode === 'priority' ? 100 : value.volume}
            min={0}
            max={100}
            step={5}
            onChange={volume => set({ volume })}
            disabled={value.mode === 'priority'}
            accessibilityLabel={t('alarms.volumeLabel')}
            accessibilityValueText={t('alarms.percent', {
              percent: value.volume,
            })}
            testID={`${testID}-volume`}
          />
          <Text style={caption}>{t('alarms.volumeHint')}</Text>
        </View>
      ) : null}

      {vibration ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={label}>{t('alarms.vibration')}</Text>
          <SegmentedControl
            options={VIBRATION_PATTERNS.map(p => ({
              value: p,
              label: t(`alarms.vibration_${p}`),
            }))}
            value={value.vibration}
            onChange={v => set({ vibration: v })}
            accessibilityLabel={t('alarms.vibration')}
            testID={`${testID}-vibration`}
          />
        </View>
      ) : null}

      {showSnooze ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={label}>{t('alarms.snooze')}</Text>
          <SegmentedControl
            options={SNOOZE_CHOICES.map(m => ({
              value: String(m),
              label: m
                ? t('alarms.minutesShort', { count: m })
                : t('alarms.off'),
            }))}
            value={String(value.snoozeMinutes)}
            onChange={v => set({ snoozeMinutes: Number(v) })}
            accessibilityLabel={t('alarms.snooze')}
            testID={`${testID}-snooze`}
          />
        </View>
      ) : null}
      <Text style={caption}>{t('alarms.dndNote')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
