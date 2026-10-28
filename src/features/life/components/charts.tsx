import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

/**
 * Lightweight charts drawn with plain views (no chart library or SVG):
 * vertical bars, a calendar heatmap and labelled horizontal bars. Every
 * chart has an empty state and accessible labels.
 */

export interface BarPoint {
  label: string;
  /** null = nothing to measure (drawn as an empty slot, not as zero). */
  value: number | null;
  /** Read by screen readers, e.g. "28 Oct: 75%". */
  a11y: string;
  onPress?: () => void;
}

export function BarChart({
  points,
  max = 100,
  height = 120,
  emptyText,
  testID,
}: {
  points: BarPoint[];
  max?: number;
  height?: number;
  emptyText: string;
  testID?: string;
}) {
  const { colors, typography, radius, spacing } = useTheme();
  if (!points.some(p => p.value !== null)) {
    return (
      <Text
        testID={testID ? `${testID}-empty` : undefined}
        style={[typography.caption, { color: colors.textSecondary }]}
      >
        {emptyText}
      </Text>
    );
  }
  return (
    <View
      testID={testID}
      style={[styles.bars, { height: height + 18, gap: spacing.xs }]}
    >
      {points.map((p, i) => (
        <Pressable
          key={`${p.label}-${i}`}
          disabled={!p.onPress}
          onPress={p.onPress}
          accessibilityLabel={p.a11y}
          style={styles.barSlot}
        >
          <View style={[styles.barArea, { height }]}>
            {p.value === null ? (
              <View style={[styles.dot, { backgroundColor: colors.border }]} />
            ) : (
              <View
                style={{
                  height: Math.max(2, (Math.min(p.value, max) / max) * height),
                  backgroundColor: colors.primary,
                  borderTopLeftRadius: radius.sm,
                  borderTopRightRadius: radius.sm,
                }}
              />
            )}
          </View>
          <Text
            style={[
              typography.caption,
              styles.barLabel,
              { color: colors.textSecondary },
            ]}
            numberOfLines={1}
          >
            {p.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export interface HeatCell {
  key: string;
  /** 0–1 intensity, or null for "nothing scheduled". */
  value: number | null;
  a11y: string;
  onPress?: () => void;
}

/** Columns = weeks (Mon→Sun top to bottom). */
export function Heatmap({
  weeks,
  testID,
}: {
  weeks: HeatCell[][];
  testID?: string;
}) {
  const { colors, radius } = useTheme();
  return (
    <View testID={testID} style={styles.heat}>
      {weeks.map((week, w) => (
        <View key={w} style={styles.heatCol}>
          {week.map(cell => (
            <Pressable
              key={cell.key}
              disabled={!cell.onPress}
              onPress={cell.onPress}
              accessibilityLabel={cell.a11y}
              style={[
                styles.heatCell,
                {
                  borderRadius: radius.sm,
                  backgroundColor:
                    cell.value === null ? colors.surfaceMuted : colors.primary,
                },
                cell.value !== null && { opacity: 0.2 + 0.8 * cell.value },
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export function HBars({
  rows,
  emptyText,
  testID,
}: {
  rows: { label: string; value: number; suffix?: string }[];
  emptyText: string;
  testID?: string;
}) {
  const { colors, typography, radius, spacing } = useTheme();
  if (!rows.length) {
    return (
      <Text
        testID={testID ? `${testID}-empty` : undefined}
        style={[typography.caption, { color: colors.textSecondary }]}
      >
        {emptyText}
      </Text>
    );
  }
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <View testID={testID} style={{ gap: spacing.sm }}>
      {rows.map(r => (
        <View
          key={r.label}
          accessibilityLabel={`${r.label}: ${r.value}${r.suffix ?? ''}`}
        >
          <View style={styles.hRow}>
            <Text
              style={[
                typography.caption,
                styles.flex,
                { color: colors.textPrimary },
              ]}
              numberOfLines={1}
            >
              {r.label}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {r.value}
              {r.suffix ?? ''}
            </Text>
          </View>
          <View
            style={[
              styles.hTrack,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: radius.pill,
              },
            ]}
          >
            <View
              style={{
                width: `${(r.value / max) * 100}%`,
                ...styles.hbarFill,
                backgroundColor: colors.primary,
                borderRadius: radius.pill,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  barSlot: { flex: 1, alignItems: 'stretch' },
  barArea: { justifyContent: 'flex-end' },
  barLabel: { textAlign: 'center', fontSize: 10 },
  dot: { height: 2, marginHorizontal: 4 },
  heat: { flexDirection: 'row', gap: 3 },
  heatCol: { gap: 3, flex: 1 },
  heatCell: { aspectRatio: 1 },
  hbarFill: { height: 8 },
  hRow: { flexDirection: 'row', marginBottom: 4 },
  hTrack: { height: 8, overflow: 'hidden' },
  flex: { flex: 1 },
});
