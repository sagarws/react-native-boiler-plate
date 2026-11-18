import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Header } from '@/shared/components';
import { useTheme } from '@/theme';
import { useStopwatch } from '../hooks/useClock';
import { formatClock, MAX_LAPS, type LapRow } from '../services/clock';

/**
 * Stopwatch with laps. Keeps counting while the app is in the background or
 * closed (it stores when it started, not a running counter).
 */
export default function StopwatchScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const sw = useStopwatch();
  const started = sw.running || sw.elapsedMs > 0;

  const renderLap = ({ item }: { item: LapRow }) => (
    <View
      testID={`lap-${item.index}`}
      accessible
      accessibilityLabel={t('utility.lapA11y', {
        n: item.index,
        split: formatClock(item.splitMs, true),
        total: formatClock(item.totalMs, true),
      })}
      style={[
        styles.lap,
        {
          borderBottomColor: colors.divider,
          paddingVertical: spacing.sm,
          gap: spacing.md,
        },
      ]}
    >
      <Text
        style={[typography.body, styles.lapNo, { color: colors.textSecondary }]}
      >
        {t('utility.lapN', { n: item.index })}
      </Text>
      <Text
        style={[
          typography.body,
          styles.flex,
          {
            color: item.fastest
              ? colors.success
              : item.slowest
              ? colors.error
              : colors.textPrimary,
          },
        ]}
      >
        {formatClock(item.splitMs, true)}
        {item.fastest ? ` · ${t('utility.fastest')}` : ''}
        {item.slowest ? ` · ${t('utility.slowest')}` : ''}
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        {formatClock(item.totalMs, true)}
      </Text>
    </View>
  );

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_stopwatch')} />
      <View style={{ padding: spacing.lg, gap: spacing.lg }}>
        <View
          style={[
            styles.face,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: radius.xl,
              paddingVertical: spacing.xl,
            },
          ]}
        >
          <Text
            testID="stopwatch-time"
            accessibilityRole="timer"
            accessibilityLiveRegion="none"
            style={[
              typography.display,
              styles.time,
              { color: colors.textPrimary },
            ]}
          >
            {formatClock(sw.elapsedMs, true)}
          </Text>
        </View>
        <View style={[styles.row, { gap: spacing.sm }]}>
          {sw.running ? (
            <Button
              variant="secondary"
              iconName="plus"
              label={t('utility.lap')}
              onPress={sw.lap}
              disabled={sw.laps.length >= MAX_LAPS}
              style={styles.flex}
              testID="stopwatch-lap"
            />
          ) : (
            <Button
              variant="secondary"
              iconName="rotateCcw"
              label={t('utility.reset')}
              onPress={sw.reset}
              disabled={!started}
              style={styles.flex}
              testID="stopwatch-reset"
            />
          )}
          {sw.running ? (
            <Button
              variant="danger"
              iconName="pause"
              label={t('utility.pause')}
              onPress={sw.pause}
              style={styles.flex}
              testID="stopwatch-pause"
            />
          ) : (
            <Button
              iconName="play"
              label={started ? t('utility.resume') : t('utility.start')}
              onPress={sw.start}
              style={styles.flex}
              testID="stopwatch-start"
            />
          )}
        </View>
      </View>
      <FlatList
        data={sw.laps}
        keyExtractor={l => String(l.index)}
        renderItem={renderLap}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: bottom + spacing.xl,
        }}
        ListEmptyComponent={
          <Text
            style={[
              typography.caption,
              styles.center,
              { color: colors.textSecondary },
            ]}
          >
            {t('utility.lapsEmpty')}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  face: { borderWidth: 1, alignItems: 'center' },
  time: { fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
  lap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lapNo: { minWidth: 64 },
  center: { textAlign: 'center' },
});
