import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  Header,
  ListRow,
  Notice,
  SegmentedControl,
  ToggleSwitch,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { useUtilityData, useWaterEject } from '../hooks/useUtility';
import { utilityStore } from '../store/utility.store';
import { WATER_DURATIONS, WATER_MODES } from '../types';

/**
 * Speaker Water Eject: plays a generated low tone (and, if chosen, a gentle
 * vibration) for a set time to help shake some water out of the speaker
 * grille. Nothing plays until Start; Stop, leaving the screen or another
 * app's audio stops it at once.
 */
export default function WaterEjectScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();
  const { prefs } = useUtilityData();
  const water = useWaterEject();
  const playing = water.state.kind === 'playing';

  const ended =
    water.state.kind === 'ended'
      ? water.state.reason
      : water.state.kind === 'denied'
      ? 'denied'
      : water.state.kind === 'unavailable'
      ? 'unavailable'
      : null;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_water')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <Notice
          tone="warning"
          title={t('utility.waterSafetyTitle')}
          message={t('utility.waterSafety')}
        />
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('utility.waterHowTitle')}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {t('utility.waterHow')}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('utility.waterVolume')}
            </Text>
          </View>
        </Card>

        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {t('utility.waterMode')}
        </Text>
        <SegmentedControl
          options={WATER_MODES.map(m => ({
            value: m,
            label: t(`utility.waterMode_${m}`),
          }))}
          value={prefs.waterMode}
          onChange={waterMode =>
            !playing && utilityStore.updatePrefs({ waterMode })
          }
          accessibilityLabel={t('utility.waterMode')}
          testID="water-mode"
        />
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t(`utility.waterModeHint_${prefs.waterMode}`)}
        </Text>

        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {t('utility.waterDuration')}
        </Text>
        <SegmentedControl
          options={WATER_DURATIONS.map(s => ({
            value: String(s),
            label: t('utility.seconds', { count: s }),
          }))}
          value={String(prefs.waterSeconds)}
          onChange={v =>
            !playing && utilityStore.updatePrefs({ waterSeconds: Number(v) })
          }
          accessibilityLabel={t('utility.waterDuration')}
          testID="water-duration"
        />

        <ListRow
          icon="vibrate"
          title={t('utility.waterVibrate')}
          subtitle={
            water.hasVibrator
              ? t('utility.waterVibrateHint')
              : t('utility.noVibrator')
          }
          right={
            <ToggleSwitch
              isOn={prefs.waterVibrate && water.hasVibrator}
              disabled={!water.hasVibrator || playing}
              onToggle={waterVibrate =>
                utilityStore.updatePrefs({ waterVibrate })
              }
              accessibilityLabel={t('utility.waterVibrate')}
            />
          }
        />

        <View
          style={[
            styles.center,
            { gap: spacing.sm, paddingVertical: spacing.md },
          ]}
        >
          <Text
            style={[
              typography.h1,
              { color: playing ? colors.primaryText : colors.textSecondary },
            ]}
            accessibilityLiveRegion="polite"
            testID="water-countdown"
          >
            {playing
              ? t('utility.secondsLeft', { count: water.remaining })
              : t('utility.seconds', { count: prefs.waterSeconds })}
          </Text>
          {ended ? (
            <Text
              style={[typography.caption, { color: colors.textSecondary }]}
              testID="water-ended"
            >
              {t(`utility.waterEnded_${ended}`)}
            </Text>
          ) : null}
        </View>

        {playing ? (
          <Button
            label={t('utility.stop')}
            variant="danger"
            onPress={water.stop}
            testID="water-stop"
          />
        ) : (
          <Button
            label={t('utility.start')}
            iconName="volume2"
            onPress={() => {
              void water.start(
                prefs.waterMode,
                prefs.waterSeconds,
                prefs.waterVibrate,
              );
            }}
            testID="water-start"
          />
        )}
        <Text
          style={[
            typography.caption,
            styles.centerText,
            { color: colors.textSecondary },
          ]}
        >
          {t('utility.waterDisclaimer')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
});
