import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';

/**
 * Detail-page charts, drawn with plain views like `charts.tsx` (no chart
 * library or SVG): a multi-line % chart and paired target / actual bars.
 * Both have an empty state, a tap-to-inspect detail row and accessible
 * per-point labels.
 */

export type LineStyle = 'solid' | 'bold' | 'dashed';

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  /** One value per x position; null = no value there (gap). */
  values: (number | null)[];
  style: LineStyle;
}

const GUTTER = 34;
const DOT = 6;

interface Pt {
  x: number;
  y: number;
}

/** One straight piece between two points, as a rotated view. */
function Segment({
  a,
  b,
  color,
  thickness,
}: {
  a: Pt;
  b: Pt;
  color: string;
  thickness: number;
}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.5) return null;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.abs,
        {
          left: (a.x + b.x) / 2 - length / 2,
          top: (a.y + b.y) / 2 - thickness / 2,
          width: length,
          height: thickness,
          backgroundColor: color,
          borderRadius: thickness / 2,
          transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
        },
      ]}
    />
  );
}

function Line({
  points,
  color,
  style,
}: {
  points: (Pt | null)[];
  color: string;
  style: LineStyle;
}) {
  const thickness = style === 'bold' ? 3 : 2;
  const pieces: React.ReactElement[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    if (style !== 'dashed') {
      pieces.push(
        <Segment key={i} a={a} b={b} color={color} thickness={thickness} />,
      );
      continue;
    }
    // Dashes: 6 on, 4 off along the segment.
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.floor(length / 10));
    for (let k = 0; k < steps; k++) {
      const f1 = (k * 10) / length;
      const f2 = Math.min(1, (k * 10 + 6) / length);
      pieces.push(
        <Segment
          key={`${i}-${k}`}
          a={{ x: a.x + (b.x - a.x) * f1, y: a.y + (b.y - a.y) * f1 }}
          b={{ x: a.x + (b.x - a.x) * f2, y: a.y + (b.y - a.y) * f2 }}
          color={color}
          thickness={thickness}
        />,
      );
    }
  }
  return <>{pieces}</>;
}

/**
 * Lines on a shared 0–[yMax] axis (values above it are drawn at the top;
 * the detail row shows the real value). Tap a column to inspect it.
 */
export function LineChart({
  series,
  labels,
  a11yLabels,
  format,
  yMax = 100,
  height = 160,
  emptyText,
  testID,
}: {
  series: LineSeries[];
  /** Short x-axis labels (one per position). */
  labels: string[];
  /** Full labels for the detail row and screen readers. */
  a11yLabels: string[];
  format: (v: number) => string;
  yMax?: number;
  height?: number;
  emptyText: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [width, setWidth] = useState(300);
  const n = labels.length;
  const lastWithData = (() => {
    for (let i = n - 1; i >= 0; i--)
      if (series.some(s => s.values[i] !== null)) return i;
    return -1;
  })();
  const [picked, setPicked] = useState<number | null>(null);
  const selected = picked !== null && picked < n ? picked : lastWithData;
  const caption = [typography.caption, { color: colors.textSecondary }];

  if (!n || !series.some(s => s.values.some(v => v !== null))) {
    return (
      <Text testID={testID ? `${testID}-empty` : undefined} style={caption}>
        {emptyText}
      </Text>
    );
  }

  const plot = Math.max(1, width - GUTTER - DOT);
  const xAt = (i: number) =>
    GUTTER + DOT / 2 + (n === 1 ? plot / 2 : (plot * i) / (n - 1));
  const yAt = (v: number) =>
    DOT / 2 + height - (Math.max(0, Math.min(yMax, v)) / yMax) * height;
  const step = Math.max(1, Math.ceil(n / 5));
  const colW = n === 1 ? plot : plot / (n - 1);

  return (
    <View testID={testID} style={{ gap: spacing.sm }}>
      <View
        onLayout={e => setWidth(e.nativeEvent.layout.width)}
        style={{ height: height + DOT }}
      >
        {[0, 0.5, 1].map(f => (
          <React.Fragment key={f}>
            <View
              style={[
                styles.abs,
                styles.grid,
                {
                  left: GUTTER,
                  top: yAt(yMax * f),
                  backgroundColor: colors.border,
                },
              ]}
            />
            <Text
              style={[
                caption,
                styles.abs,
                styles.axis,
                { top: yAt(yMax * f) - 8, width: GUTTER - 4 },
              ]}
            >
              {format(yMax * f)}
            </Text>
          </React.Fragment>
        ))}
        {selected >= 0 ? (
          <View
            style={[
              styles.abs,
              styles.cursor,
              styles.top0,
              {
                left: xAt(selected),
                height: height + DOT,
                backgroundColor: colors.border,
              },
            ]}
          />
        ) : null}
        {series.map(s => {
          const pts = s.values.map((v, i) =>
            v === null ? null : { x: xAt(i), y: yAt(v) },
          );
          return (
            <React.Fragment key={s.id}>
              <Line points={pts} color={s.color} style={s.style} />
              {pts.map((p, i) =>
                p ? (
                  <View
                    key={i}
                    pointerEvents="none"
                    style={[
                      styles.abs,
                      {
                        left: p.x - DOT / 2,
                        top: p.y - DOT / 2,
                        width: DOT,
                        height: DOT,
                        borderRadius: DOT / 2,
                        backgroundColor:
                          s.style === 'dashed' ? colors.card : s.color,
                        borderColor: s.color,
                      },
                      s.style === 'dashed' && styles.hollowDot,
                    ]}
                  />
                ) : null,
              )}
            </React.Fragment>
          );
        })}
        {labels.map((_, i) => (
          <Pressable
            key={i}
            onPress={() => setPicked(i)}
            accessibilityRole="button"
            accessibilityState={{ selected: i === selected }}
            accessibilityLabel={`${a11yLabels[i]}: ${series
              .map(s =>
                s.values[i] === null
                  ? `${s.label} ${t('life.chartNoValue')}`
                  : `${s.label} ${format(s.values[i]!)}`,
              )
              .join(', ')}`}
            testID={testID ? `${testID}-col-${i}` : undefined}
            style={[
              styles.abs,
              styles.top0,
              {
                left: xAt(i) - colW / 2,
                width: colW,
                height: height + DOT,
              },
            ]}
          />
        ))}
      </View>
      <View style={[styles.xAxis, styles.xAxisH]}>
        {labels.map((l, i) =>
          i % step === 0 || i === n - 1 ? (
            <Text
              key={i}
              numberOfLines={1}
              style={[
                caption,
                styles.abs,
                styles.xLabel,
                { left: xAt(i) - 30 },
              ]}
            >
              {l}
            </Text>
          ) : null,
        )}
      </View>
      {selected >= 0 ? (
        <View
          testID={testID ? `${testID}-detail` : undefined}
          style={[
            styles.gap2,
            {
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.md,
              padding: spacing.sm,
            },
          ]}
        >
          <Text style={[typography.label, { color: colors.textPrimary }]}>
            {a11yLabels[selected]}
          </Text>
          {series.map(s => (
            <View key={s.id} style={[styles.row, { gap: spacing.xs }]}>
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: s.color, borderRadius: radius.sm },
                ]}
              />
              <Text style={[caption, styles.flex]} numberOfLines={1}>
                {s.label}
              </Text>
              <Text style={[typography.caption, { color: colors.textPrimary }]}>
                {s.values[selected] === null
                  ? t('life.chartNoValue')
                  : format(s.values[selected]!)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export interface TargetActualRow {
  key: string;
  label: string;
  target: number;
  actual: number;
  /** completed / target × 100, unclamped. */
  percent: number;
  /** Full period text for the detail row and screen readers. */
  title: string;
}

/**
 * Target and actual side by side per period, on one axis in the task's own
 * unit; the completion % is shown as text, not on the axis.
 */
export function TargetActualChart({
  rows,
  unit,
  color,
  format,
  height = 120,
  emptyText,
  testID,
}: {
  rows: TargetActualRow[];
  unit: string;
  color: string;
  format: (v: number) => string;
  height?: number;
  emptyText: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const caption = [typography.caption, { color: colors.textSecondary }];
  if (!rows.length) {
    return (
      <Text testID={testID ? `${testID}-empty` : undefined} style={caption}>
        {emptyText}
      </Text>
    );
  }
  const max = Math.max(1, ...rows.map(r => Math.max(r.target, r.actual)));
  const bar = (v: number) => Math.max(2, (v / max) * height);
  const selected = rows.find(r => r.key === picked) ?? rows[rows.length - 1];
  const describe = (r: TargetActualRow) =>
    t('life.chartPeriodValues', {
      period: r.title,
      target: format(r.target),
      actual: format(r.actual),
      unit,
      percent: Math.round(r.percent),
    });

  return (
    <View testID={testID} style={{ gap: spacing.sm }}>
      <Text style={caption}>{t('life.chartUnitAxis', { unit })}</Text>
      <View style={[styles.bars, { gap: spacing.xs }]}>
        {rows.map(r => {
          const isSel = r.key === selected.key;
          return (
            <Pressable
              key={r.key}
              onPress={() => setPicked(r.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSel }}
              accessibilityLabel={describe(r)}
              testID={testID ? `${testID}-bar-${r.key}` : undefined}
              style={[
                styles.slot,
                { borderRadius: radius.sm },
                isSel && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Text style={[caption, styles.center]} numberOfLines={1}>
                {Math.round(r.percent)}%
              </Text>
              <View style={[styles.pair, { height }]}>
                <View
                  style={[
                    styles.flex,
                    styles.outlined,
                    {
                      height: bar(r.target),
                      borderColor: colors.textSecondary,
                      backgroundColor: colors.card,
                      borderTopLeftRadius: radius.sm,
                      borderTopRightRadius: radius.sm,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.flex,
                    {
                      height: bar(r.actual),
                      backgroundColor: color,
                      borderTopLeftRadius: radius.sm,
                      borderTopRightRadius: radius.sm,
                    },
                    r.actual > 0 ? null : styles.invisible,
                  ]}
                />
              </View>
              <Text style={[caption, styles.barLabel]} numberOfLines={1}>
                {r.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={[styles.row, { gap: spacing.xs }]}>
          <View
            style={[
              styles.swatch,
              styles.outlined,
              {
                borderColor: colors.textSecondary,
                borderRadius: radius.sm,
              },
            ]}
          />
          <Text style={caption}>{t('life.chartTarget')}</Text>
        </View>
        <View style={[styles.row, { gap: spacing.xs }]}>
          <View
            style={[
              styles.swatch,
              { backgroundColor: color, borderRadius: radius.sm },
            ]}
          />
          <Text style={caption}>{t('life.chartActual')}</Text>
        </View>
      </View>
      <Text
        testID={testID ? `${testID}-detail` : undefined}
        style={[typography.body, { color: colors.textPrimary }]}
      >
        {describe(selected)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  grid: { height: StyleSheet.hairlineWidth, right: 0 },
  top0: { top: 0 },
  xAxisH: { height: 16 },
  gap2: { gap: 2 },
  outlined: { borderWidth: 1 },
  hollowDot: { borderWidth: 1.5 },
  invisible: { opacity: 0 },
  cursor: { width: 1 },
  axis: { left: 0, textAlign: 'right' },
  xAxis: { position: 'relative' },
  xLabel: { width: 60, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  swatch: { width: 12, height: 12 },
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  slot: { flex: 1, alignItems: 'stretch', paddingVertical: 2 },
  pair: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  center: { textAlign: 'center' },
  // Matches charts.tsx bar labels: must fit narrow columns.
  barLabel: { textAlign: 'center', fontSize: 10 },
});
