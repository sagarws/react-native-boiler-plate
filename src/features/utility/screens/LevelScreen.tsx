import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, Header, Loader } from '@/shared/components';
import { useTheme } from '@/theme';
import { useTilt, useUtilityData } from '../hooks/useUtility';
import {
  NO_CALIBRATION,
  bubbleOffset,
  levelReading,
  rawAngles,
} from '../services/level';
import { utilityStore } from '../store/utility.store';

const DIAL = 240;
const BUBBLE = 44;

const fmt = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}°`;

/**
 * Bubble level. Flat on a surface: a round bubble with left–right and
 * front–back tilt. Standing on an edge: one angle, like a spirit level.
 * Calibrate zeroes it on a surface you know is level. The sensor runs only
 * while this screen is open.
 */
export default function LevelScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const { support, reading } = useTilt();
  const { prefs } = useUtilityData();
  const level = reading ? levelReading(reading, prefs.levelCalibration) : null;
  const ok = level?.level ?? false;
  const accent = ok ? colors.success : colors.primary;

  const calibrate = () => {
    if (!reading) return;
    const raw = rawAngles(reading);
    const current = prefs.levelCalibration;
    utilityStore.updatePrefs({
      levelCalibration:
        level?.mode === 'flat'
          ? { ...current, x: raw.x, y: raw.y }
          : { ...current, edge: raw.edge },
    });
  };

  let body: React.ReactNode;
  if (support === 'checking') body = <Loader />;
  else if (support === 'none')
    body = (
      <EmptyState
        icon="crosshair"
        title={t('utility.levelNoSensorTitle')}
        message={t('utility.levelNoSensorBody')}
        testID="level-unsupported"
      />
    );
  else if (!level)
    body = (
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        {t('utility.levelWaiting')}
      </Text>
    );
  else if (level.mode === 'flat') {
    const { dx, dy } = bubbleOffset(level.x, level.y, (DIAL - BUBBLE) / 2);
    body = (
      <View
        style={[styles.center, { gap: spacing.md }]}
        accessible
        accessibilityLabel={t('utility.levelFlatA11y', {
          x: fmt(level.x),
          y: fmt(level.y),
        })}
        testID="level-flat"
      >
        <View
          style={[
            styles.dial,
            {
              borderColor: accent,
              backgroundColor: colors.surfaceMuted,
            },
          ]}
        >
          <View style={[styles.ring, { borderColor: colors.textSecondary }]} />
          <View
            style={[
              styles.bubble,
              {
                backgroundColor: accent,
                transform: [{ translateX: dx }, { translateY: dy }],
              },
            ]}
          />
        </View>
        <View style={[styles.row, { gap: spacing.xl }]}>
          <Text style={[typography.title, { color: colors.textPrimary }]}>
            ↔ {fmt(level.x)}
          </Text>
          <Text style={[typography.title, { color: colors.textPrimary }]}>
            ↕ {fmt(level.y)}
          </Text>
        </View>
      </View>
    );
  } else {
    body = (
      <View
        style={[styles.center, { gap: spacing.md }]}
        accessible
        accessibilityLabel={t('utility.levelEdgeA11y', {
          angle: fmt(level.angle),
        })}
        testID="level-edge"
      >
        <View
          style={[
            styles.edgeBox,
            {
              borderColor: accent,
              borderRadius: radius.lg,
              backgroundColor: colors.surfaceMuted,
            },
          ]}
        >
          <View
            style={[
              styles.edgeLine,
              {
                backgroundColor: accent,
                transform: [{ rotate: `${-level.angle}deg` }],
              },
            ]}
          />
        </View>
        <Text style={[typography.display, { color: colors.textPrimary }]}>
          {fmt(level.angle)}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_level')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.lg,
        }}
      >
        {body}
        {level ? (
          <Text
            testID="level-status"
            style={[
              typography.label,
              styles.text,
              { color: ok ? colors.success : colors.textSecondary },
            ]}
          >
            {ok ? t('utility.levelOk') : t(`utility.levelHint_${level.mode}`)}
          </Text>
        ) : null}
        {support !== 'none' && support !== 'checking' ? (
          <View style={{ gap: spacing.sm }}>
            <Button
              variant="secondary"
              label={t('utility.calibrate')}
              onPress={calibrate}
              disabled={!reading}
              testID="level-calibrate"
            />
            <Button
              variant="ghost"
              label={t('utility.calibrateReset')}
              onPress={() =>
                utilityStore.updatePrefs({ levelCalibration: NO_CALIBRATION })
              }
              testID="level-calibrate-reset"
            />
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('utility.calibrateHint')}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center' },
  row: { flexDirection: 'row' },
  text: { textAlign: 'center' },
  dial: {
    width: DIAL,
    height: DIAL,
    borderRadius: DIAL / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: BUBBLE + 12,
    height: BUBBLE + 12,
    borderRadius: (BUBBLE + 12) / 2,
    borderWidth: 1,
  },
  bubble: { width: BUBBLE, height: BUBBLE, borderRadius: BUBBLE / 2 },
  edgeBox: {
    width: DIAL,
    height: 120,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  edgeLine: { width: DIAL * 1.2, height: 4 },
});
