import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import {
  PROGRESS_LEVELS,
  percentOf,
  type PeriodBar,
  type ProgressLevel,
} from '../services/progress';
import { levelStyle } from '../utils/levelColors';
import { formatDay, formatPeriod, formatQty } from '../utils/format';

/**
 * Progress visuals for the task and project detail pages, drawn with plain
 * views like the other Manage Life charts (no chart library or SVG). Every
 * chart has an empty state and spoken values.
 */

// ── Legend ────────────────────────────────────────────────────────────

/** Colour scale key: no data, then low → full, each with its range. */
export function LevelLegend({ base }: { base: string }) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const items: ProgressLevel[] = ['none', ...PROGRESS_LEVELS];
  return (
    <View style={[styles.wrap, { gap: spacing.sm }]} testID="level-legend">
      {items.map(level => {
        const s = levelStyle(base, level, colors);
        return (
          <View key={level} style={[styles.row, { gap: spacing.xs }]}>
            <View
              style={[
                styles.swatch,
                {
                  backgroundColor: s.background,
                  borderRadius: radius.sm,
                  borderColor: colors.border,
                },
              ]}
            />
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t(`life.level_${level}`)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Task chart: target vs actual per period ───────────────────────────

const PAGE = 10;

/**
 * Bars of what was done per target period, in the task's unit, with the
 * period's target drawn as a marker across each bar and the percent above.
 * Pages through periods ten at a time (newest first shown).
 */
export function TargetActualChart({
  bars,
  unit,
  color,
  height = 140,
  testID = 'task-chart',
}: {
  bars: PeriodBar[];
  unit: string;
  color: string;
  height?: number;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const pages = Math.max(1, Math.ceil(bars.length / PAGE));
  const [page, setPage] = useState(0); // 0 = newest
  const [selected, setSelected] = useState<number | null>(null);
  const end = bars.length - page * PAGE;
  const visible = bars.slice(Math.max(0, end - PAGE), end);
  const max = Math.max(1, ...visible.map(b => Math.max(b.target, b.completed)));
  const caption = [typography.caption, { color: colors.textSecondary }];

  if (!bars.some(b => b.ratio !== null)) {
    return (
      <Text style={caption} testID={`${testID}-empty`}>
        {t('life.chartNoReports')}
      </Text>
    );
  }
  const pick = selected !== null ? visible[selected] : null;
  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      <View style={styles.row}>
        <Text style={[caption, styles.flex]}>
          {t('life.chartAxisUnit', { unit, max: formatQty(max) })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('life.chartOlder')}
          disabled={page >= pages - 1}
          onPress={() => {
            setPage(p => p + 1);
            setSelected(null);
          }}
          style={[styles.nav, page >= pages - 1 && styles.dim]}
          testID={`${testID}-older`}
        >
          <Icon name="arrowLeft" size={18} color={colors.textPrimary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('life.chartNewer')}
          disabled={page === 0}
          onPress={() => {
            setPage(p => p - 1);
            setSelected(null);
          }}
          style={[styles.nav, page === 0 && styles.dim]}
          testID={`${testID}-newer`}
        >
          <Icon name="chevronRight" size={18} color={colors.textPrimary} />
        </Pressable>
      </View>
      <View style={[styles.bars, { height: height + 34, gap: spacing.xs }]}>
        {visible.map((b, i) => {
          const done = (Math.min(b.completed, max) / max) * height;
          // A logged amount always shows at least a sliver.
          const barHeight = b.completed > 0 ? Math.max(2, done) : 0;
          const target = (b.target / max) * height;
          const pct = b.ratio === null ? null : percentOf(b.ratio);
          const label = formatDay(b.start);
          return (
            <Pressable
              key={b.start}
              onPress={() => setSelected(i === selected ? null : i)}
              accessibilityRole="button"
              accessibilityLabel={t('life.chartBarA11y', {
                period: formatPeriod(b.start, b.end),
                done: formatQty(b.completed),
                target: formatQty(b.target),
                unit,
                percent: pct ?? 0,
              })}
              style={styles.barSlot}
              testID={`${testID}-bar-${b.start}`}
            >
              <Text
                style={[typography.overline, styles.plain, caption]}
                numberOfLines={1}
              >
                {pct === null ? '–' : `${pct}%`}
              </Text>
              <View style={[styles.barArea, { height }]}>
                <View
                  style={[
                    i === selected || selected === null ? null : styles.faded,
                    {
                      height: barHeight,
                      backgroundColor: color,
                      borderTopLeftRadius: radius.sm,
                      borderTopRightRadius: radius.sm,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.targetMark,
                    { bottom: target - 1, backgroundColor: colors.textPrimary },
                  ]}
                />
              </View>
              <Text
                style={[typography.overline, styles.plain, caption]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.wrap, { gap: spacing.md }]}>
        <View style={[styles.row, { gap: spacing.xs }]}>
          <View
            style={[
              styles.swatch,
              { backgroundColor: color, borderRadius: radius.sm },
            ]}
          />
          <Text style={caption}>{t('life.chartActual', { unit })}</Text>
        </View>
        <View style={[styles.row, { gap: spacing.xs }]}>
          <View
            style={[styles.targetKey, { backgroundColor: colors.textPrimary }]}
          />
          <Text style={caption}>{t('life.chartTarget', { unit })}</Text>
        </View>
      </View>
      {pick ? (
        <Text
          style={[typography.body, { color: colors.textPrimary }]}
          testID={`${testID}-detail`}
        >
          {t('life.chartBarDetail', {
            period: formatPeriod(pick.start, pick.end),
            done: formatQty(pick.completed),
            target: formatQty(pick.target),
            unit,
            percent: pick.ratio === null ? 0 : percentOf(pick.ratio),
          })}
        </Text>
      ) : null}
    </View>
  );
}

// ── Project chart: toggleable lines on a 0–100% axis ──────────────────

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** Averages are drawn thicker with markers so they stand out. */
  emphasis?: 'actual' | 'target';
}

/** Adds or removes [key] — a line's visibility toggle. */
export function toggleKey(
  hidden: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(hidden);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function Segment({
  x1,
  y1,
  x2,
  y2,
  color,
  width,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return (
    <View
      pointerEvents="none"
      style={{
        ...styles.absolute,
        left: (x1 + x2) / 2 - length / 2,
        top: (y1 + y2) / 2 - width / 2,
        width: length,
        height: width,
        backgroundColor: color,
        borderRadius: width / 2,
        transform: [{ rotate: `${angle}rad` }],
      }}
    />
  );
}

/**
 * Lines on a shared 0–100% axis with one toggle chip per line. Tapping the
 * plot picks the nearest day and lists every visible line's value.
 */
export function ProgressLineChart({
  days,
  series,
  initiallyHidden = [],
  height = 180,
  emptyText,
  testID = 'line-chart',
}: {
  days: string[];
  series: LineSeries[];
  initiallyHidden?: string[];
  height?: number;
  emptyText: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [width, setWidth] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(initiallyHidden),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const caption = [typography.caption, { color: colors.textSecondary }];
  const shown = useMemo(
    () => series.filter(s => !hidden.has(s.key)),
    [series, hidden],
  );
  const hasData = series.some(s => s.values.some(v => v !== null));
  if (!days.length || !hasData) {
    return (
      <Text style={caption} testID={`${testID}-empty`}>
        {emptyText}
      </Text>
    );
  }

  const axis = 34;
  const plotW = Math.max(0, width - axis);
  const x = (i: number) =>
    axis + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
  const y = (v: number) =>
    height - (Math.min(100, Math.max(0, v)) / 100) * height;
  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);
  const pickAt = (px: number) => {
    if (plotW <= 0) return;
    const i = Math.round(((px - axis) / plotW) * (days.length - 1));
    setSelected(Math.max(0, Math.min(days.length - 1, i)));
  };
  const valueText = (v: number | null) =>
    v === null ? '–' : `${Math.round(v)}%`;

  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.xs }}
        testID={`${testID}-legend`}
      >
        {series.map(s => {
          const on = !hidden.has(s.key);
          return (
            <Pressable
              key={s.key}
              onPress={() => setHidden(h => toggleKey(h, s.key))}
              accessibilityRole="switch"
              accessibilityState={{ checked: on }}
              accessibilityLabel={t('life.chartToggle', { name: s.label })}
              style={[
                styles.chip,
                {
                  borderRadius: radius.pill,
                  borderColor: on ? s.color : colors.border,
                  backgroundColor: on ? colors.surface : colors.surfaceMuted,
                  paddingHorizontal: spacing.sm,
                  gap: spacing.xs,
                },
              ]}
              testID={`${testID}-toggle-${s.key}`}
            >
              <View
                style={[
                  s.emphasis === 'target' ? styles.squareKey : styles.dotKey,
                  { backgroundColor: on ? s.color : colors.border },
                ]}
              />
              <Text
                style={[
                  typography.caption,
                  {
                    color: on ? colors.textPrimary : colors.textSecondary,
                  },
                  !on && styles.struck,
                ]}
                numberOfLines={1}
              >
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View onLayout={onLayout} style={{ height: height + 22 }}>
        {[0, 50, 100].map(v => (
          <View key={v} pointerEvents="none">
            <View
              style={[
                styles.grid,
                { top: y(v), left: axis, backgroundColor: colors.divider },
              ]}
            />
            <Text
              style={[
                typography.overline,
                styles.plain,
                caption,
                styles.yLabel,
                { top: y(v) - 8 },
              ]}
            >
              {v}%
            </Text>
          </View>
        ))}
        {width > 0
          ? shown.map(s => {
              const w = s.emphasis ? 4 : 2;
              const parts: React.ReactNode[] = [];
              s.values.forEach((v, i) => {
                const next = s.values[i + 1];
                if (
                  v !== null &&
                  next !== null &&
                  next !== undefined &&
                  i + 1 < days.length
                ) {
                  parts.push(
                    <Segment
                      key={`${s.key}-l${i}`}
                      x1={x(i)}
                      y1={y(v)}
                      x2={x(i + 1)}
                      y2={y(next)}
                      color={s.color}
                      width={w}
                    />,
                  );
                }
                if (
                  v !== null &&
                  (s.emphasis || days.length <= 12 || i === selected)
                ) {
                  const size = s.emphasis ? 8 : 6;
                  parts.push(
                    <View
                      key={`${s.key}-p${i}`}
                      pointerEvents="none"
                      style={[
                        styles.absolute,
                        s.emphasis === 'target' ? styles.squareMarker : null,
                        {
                          left: x(i) - size / 2,
                          top: y(v) - size / 2,
                          width: size,
                          height: size,
                          backgroundColor: s.color,
                        },
                        s.emphasis === 'target'
                          ? null
                          : { borderRadius: size / 2 },
                      ]}
                    />,
                  );
                }
              });
              return <React.Fragment key={s.key}>{parts}</React.Fragment>;
            })
          : null}
        {selected !== null && width > 0 ? (
          <View
            pointerEvents="none"
            style={[
              styles.guide,
              {
                left: x(selected),
                height,
                backgroundColor: colors.textSecondary,
              },
            ]}
          />
        ) : null}
        <Pressable
          style={[styles.overlay, { height }]}
          onPress={e => pickAt(e.nativeEvent.locationX)}
          accessibilityRole="adjustable"
          accessibilityLabel={t('life.chartPlotA11y')}
          accessibilityValue={{
            text:
              selected !== null
                ? `${formatDay(days[selected])}: ${shown
                    .map(s => `${s.label} ${valueText(s.values[selected])}`)
                    .join(', ')}`
                : t('life.chartTapHint'),
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={e => {
            const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
            // First swipe lands on the latest day, then steps.
            setSelected(i =>
              i === null
                ? days.length - 1
                : Math.max(0, Math.min(days.length - 1, i + step)),
            );
          }}
          testID={`${testID}-plot`}
        />
        <View
          style={[styles.xLabels, { top: height + 4, left: axis }]}
          pointerEvents="none"
        >
          <Text style={caption}>{formatDay(days[0])}</Text>
          {days.length > 2 ? (
            <Text style={caption}>
              {formatDay(days[Math.floor((days.length - 1) / 2)])}
            </Text>
          ) : null}
          <Text style={caption}>{formatDay(days[days.length - 1])}</Text>
        </View>
      </View>

      {selected !== null ? (
        <View
          style={[
            {
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.md,
              padding: spacing.sm,
              gap: spacing.xs,
            },
          ]}
          testID={`${testID}-detail`}
        >
          <Text style={[typography.label, { color: colors.textPrimary }]}>
            {formatDay(days[selected])}
          </Text>
          {shown.length === 0 ? (
            <Text style={caption}>{t('life.chartAllHidden')}</Text>
          ) : (
            shown.map(s => (
              <View key={s.key} style={[styles.row, { gap: spacing.xs }]}>
                <View
                  style={[
                    s.emphasis === 'target' ? styles.squareKey : styles.dotKey,
                    { backgroundColor: s.color },
                  ]}
                />
                <Text
                  style={[
                    typography.caption,
                    styles.flex,
                    { color: colors.textPrimary },
                  ]}
                  numberOfLines={1}
                >
                  {s.label}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textPrimary }]}
                >
                  {valueText(s.values[selected])}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : (
        <Text style={caption}>{t('life.chartTapHint')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
  dim: { opacity: 0.35 },
  faded: { opacity: 0.45 },
  absolute: { position: 'absolute' },
  struck: { textDecorationLine: 'line-through' },
  squareMarker: { borderRadius: 1 },
  plain: { textTransform: 'none', letterSpacing: 0 },
  swatch: { width: 14, height: 14, borderWidth: StyleSheet.hairlineWidth },
  nav: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  barSlot: { flex: 1, alignItems: 'stretch' },
  barArea: { justifyContent: 'flex-end' },
  targetMark: { position: 'absolute', left: -2, right: -2, height: 2 },
  targetKey: { width: 14, height: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    borderWidth: 1.5,
  },
  dotKey: { width: 10, height: 10, borderRadius: 5 },
  squareKey: { width: 10, height: 10, borderRadius: 1 },
  grid: { position: 'absolute', right: 0, height: StyleSheet.hairlineWidth },
  yLabel: { position: 'absolute', left: 0, width: 30 },
  guide: { position: 'absolute', top: 0, width: 1 },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0 },
  xLabels: {
    position: 'absolute',
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
