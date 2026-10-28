import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, Header, Loader, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import { useCompass } from '../hooks/useUtility';
import { cardinal } from '../services/units';

const DIAL = 280;
const TICKS = Array.from({ length: 72 }, (_, i) => i * 5);
const LABELS = [
  { deg: 0, key: 'N' },
  { deg: 90, key: 'E' },
  { deg: 180, key: 'S' },
  { deg: 270, key: 'W' },
] as const;

/** Position on the dial for an angle (0° = top), r from the centre. */
const at = (deg: number, r: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: DIAL / 2 + r * Math.sin(rad), y: DIAL / 2 - r * Math.cos(rad) };
};

/**
 * Digital compass: the dial turns so North on it points to magnetic north;
 * the heading at the top is where the phone's top edge points. Sensors run
 * only while this screen is open.
 */
export default function CompassScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();
  const { support, reading } = useCompass();
  const heading = reading?.heading ?? 0;
  const lowAccuracy = reading != null && reading.accuracy < 2;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_compass')} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            padding: spacing.lg,
            paddingBottom: bottom + spacing.xl,
            gap: spacing.lg,
          },
        ]}
      >
        {support === 'checking' ? (
          <Loader />
        ) : support === 'none' ? (
          <EmptyState
            icon="compass"
            title={t('utility.noSensorTitle')}
            message={t('utility.noSensorBody')}
            testID="compass-unavailable"
          />
        ) : (
          <>
            <View style={styles.center} testID="compass-heading">
              <Text
                style={[typography.h1, { color: colors.textPrimary }]}
                accessibilityLiveRegion="polite"
              >
                {reading ? `${Math.round(heading) % 360}°` : '—'}
              </Text>
              <Text style={[typography.title, { color: colors.textSecondary }]}>
                {reading
                  ? t(`utility.dir_${cardinal(heading)}`)
                  : t('utility.compassWaiting')}
              </Text>
            </View>
            <View style={styles.dialWrap}>
              {/* Fixed marker: the phone's top edge. */}
              <View
                style={[styles.marker, { borderBottomColor: colors.error }]}
              />
              <View
                style={[
                  styles.dial,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                    transform: [{ rotate: `${-heading}deg` }],
                  },
                ]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {TICKS.map(deg => {
                  const major = deg % 30 === 0;
                  const len = major ? 14 : 7;
                  const p = at(deg, DIAL / 2 - 8 - len / 2);
                  return (
                    <View
                      key={deg}
                      style={[
                        styles.tick,
                        major ? styles.tickMajor : styles.tickMinor,
                        {
                          height: len,
                          left: p.x - (major ? 1.5 : 0.75),
                          top: p.y - len / 2,
                          backgroundColor:
                            deg === 0 ? colors.error : colors.textSecondary,
                          transform: [{ rotate: `${deg}deg` }],
                        },
                      ]}
                    />
                  );
                })}
                {LABELS.map(({ deg, key }) => {
                  const p = at(deg, DIAL / 2 - 44);
                  return (
                    <Text
                      key={key}
                      style={[
                        typography.title,
                        styles.label,
                        {
                          left: p.x - 16,
                          top: p.y - 14,
                          color:
                            key === 'N' ? colors.error : colors.textPrimary,
                          transform: [{ rotate: `${deg}deg` }],
                        },
                      ]}
                    >
                      {t(`utility.dir_${key}`)}
                    </Text>
                  );
                })}
                <View
                  style={[styles.needleN, { borderBottomColor: colors.error }]}
                />
                <View
                  style={[
                    styles.needleS,
                    { borderTopColor: colors.textSecondary },
                  ]}
                />
              </View>
            </View>
            {lowAccuracy ? (
              <Notice
                tone="warning"
                title={t('utility.calibrateTitle')}
                message={t('utility.calibrateBody')}
                testID="compass-calibrate"
              />
            ) : null}
            <Text
              style={[
                typography.caption,
                styles.disclaimer,
                { color: colors.textSecondary },
              ]}
            >
              {t('utility.compassDisclaimer')}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignItems: 'center' },
  center: { alignItems: 'center' },
  dialWrap: { width: DIAL, height: DIAL + 16, alignItems: 'center' },
  marker: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 16,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  dial: { width: DIAL, height: DIAL, borderRadius: DIAL / 2, borderWidth: 2 },
  tick: { position: 'absolute', borderRadius: 1 },
  tickMajor: { width: 3 },
  tickMinor: { width: 1.5 },
  label: { position: 'absolute', width: 32, textAlign: 'center' },
  needleN: {
    position: 'absolute',
    left: DIAL / 2 - 8,
    top: DIAL / 2 - 70,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 70,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  needleS: {
    position: 'absolute',
    left: DIAL / 2 - 8,
    top: DIAL / 2,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 70,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  disclaimer: { textAlign: 'center' },
});
