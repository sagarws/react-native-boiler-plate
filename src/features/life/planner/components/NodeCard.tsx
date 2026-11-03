import React, { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/shared/components';
import type { IconName } from '@/shared/assets';
import { useTheme } from '@/theme';
import { NODE_H, NODE_W } from '../services/layout';

/**
 * Progress ring from plain views (no SVG): two clipped halves, each holding
 * a half disc that rotates around the ring's centre — the right half shows
 * 0–180°, the left half 180–360°. [hole] is the colour behind the ring.
 */
export function ProgressRing({
  percent,
  size,
  thickness,
  color,
  track,
  hole,
  children,
}: {
  percent: number;
  size: number;
  thickness: number;
  color: string;
  track: string;
  hole: string;
  children?: React.ReactNode;
}) {
  const deg = (Math.max(0, Math.min(100, percent)) / 100) * 360;
  const half = size / 2;
  const full = { width: size, height: size };
  const halfDisc = (side: 'left' | 'right') => ({
    position: 'absolute' as const,
    top: 0,
    left: side === 'left' ? 0 : half,
    width: half,
    height: size,
    backgroundColor: color,
    ...(side === 'left'
      ? { borderTopLeftRadius: half, borderBottomLeftRadius: half }
      : { borderTopRightRadius: half, borderBottomRightRadius: half }),
  });
  return (
    <View
      style={[full, { borderRadius: half, backgroundColor: track }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
    >
      <View style={[styles.clip, { left: half, width: half, height: size }]}>
        <View
          style={[
            full,
            styles.abs,
            {
              left: -half,
              transform: [{ rotate: `${Math.min(deg, 180)}deg` }],
            },
          ]}
        >
          <View style={halfDisc('left')} />
        </View>
      </View>
      {deg > 180 ? (
        <View
          style={[styles.clip, styles.left0, { width: half, height: size }]}
        >
          <View
            style={[
              full,
              styles.abs,
              styles.left0,
              { transform: [{ rotate: `${deg - 180}deg` }] },
            ]}
          >
            <View style={halfDisc('right')} />
          </View>
        </View>
      ) : null}
      <View
        style={[
          styles.hole,
          {
            top: thickness,
            left: thickness,
            width: size - thickness * 2,
            height: size - thickness * 2,
            borderRadius: half - thickness,
            backgroundColor: hole,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export interface NodeCardData {
  id: string;
  name: string;
  icon: string;
  imageUri: string;
  color: string;
  statusName: string;
  statusColor: string;
  statusKind: string;
  categoryName: string;
  categoryColor: string;
  milestone: boolean;
  progress: number | null;
  target: string;
  estimated: boolean;
  childCount: number;
  collapsed: boolean;
  overdue: boolean;
  root: boolean;
}

/** One card on the mind map. Memoised: re-renders only when its data changes. */
export const NodeCard = memo(function NodeCardView({
  data,
  selected,
  highlighted,
  compact,
}: {
  data: NodeCardData;
  selected: boolean;
  highlighted: boolean;
  compact: boolean;
}) {
  const { colors, typography, radius, spacing } = useTheme();
  const border = selected
    ? colors.primary
    : highlighted
    ? colors.warning
    : colors.border;
  const marked = selected || highlighted;
  const blockBorder = marked ? 6 : 0;
  const cardBorder = marked ? 2 : StyleSheet.hairlineWidth;
  const background = highlighted ? colors.primarySoft : colors.card;
  const corner = data.milestone ? radius.xl : radius.lg;
  if (compact) {
    // Zoomed far out: a plain block is enough and much cheaper to draw.
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: data.color,
            borderColor: border,
            borderRadius: radius.lg,
            borderWidth: blockBorder,
          },
        ]}
      />
    );
  }
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: background,
          borderColor: border,
          borderRadius: corner,
          borderWidth: cardBorder,
          padding: spacing.sm,
          gap: spacing.xs,
        },
      ]}
    >
      <View
        style={[
          styles.edge,
          {
            backgroundColor: data.color,
            borderTopLeftRadius: radius.lg,
            borderBottomLeftRadius: radius.lg,
          },
        ]}
      />
      <View style={[styles.row, { gap: spacing.xs }]}>
        {data.imageUri ? (
          <Image
            source={{ uri: data.imageUri }}
            style={[styles.avatar, { borderRadius: radius.sm }]}
          />
        ) : (
          <View
            style={[
              styles.avatar,
              { backgroundColor: data.color, borderRadius: radius.sm },
            ]}
          >
            <Icon
              name={
                (data.milestone
                  ? 'mapPin'
                  : data.icon ||
                    (data.root ? 'compass' : 'circleCheck')) as IconName
              }
              size={14}
              color={colors.primaryForeground}
            />
          </View>
        )}
        <Text
          style={[typography.label, styles.flex, { color: colors.textPrimary }]}
          numberOfLines={2}
        >
          {data.name}
        </Text>
        {data.progress !== null ? (
          <ProgressRing
            percent={data.progress}
            size={30}
            thickness={4}
            color={data.color}
            track={colors.surfaceMuted}
            hole={highlighted ? colors.primarySoft : colors.card}
          >
            <Text
              style={[
                typography.overline,
                styles.ringText,
                { color: colors.textPrimary },
              ]}
            >
              {Math.round(data.progress)}
            </Text>
          </ProgressRing>
        ) : null}
      </View>
      <View style={[styles.row, { gap: spacing.xs }]}>
        <View style={[styles.dot, { backgroundColor: data.statusColor }]} />
        <Text
          style={[
            typography.caption,
            styles.flex,
            { color: colors.textSecondary },
          ]}
          numberOfLines={1}
        >
          {data.statusName}
        </Text>
        {data.categoryName ? (
          <View
            style={[
              styles.badge,
              { borderColor: data.categoryColor, borderRadius: radius.pill },
            ]}
          >
            <Text
              style={[
                typography.overline,
                styles.badgeText,
                { color: data.categoryColor },
              ]}
              numberOfLines={1}
            >
              {data.categoryName}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.row, { gap: spacing.xs }]}>
        <Text
          style={[
            typography.caption,
            styles.flex,
            { color: data.overdue ? colors.error : colors.textSecondary },
          ]}
          numberOfLines={1}
        >
          {data.estimated ? '~' : ''}
          {data.target}
        </Text>
        {data.childCount ? (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {data.collapsed ? '▸ ' : ''}
            {data.childCount}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { width: NODE_W, height: NODE_H, overflow: 'hidden' },
  edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  avatar: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: { borderWidth: 1, paddingHorizontal: 6, maxWidth: 80 },
  badgeText: { textTransform: 'none', letterSpacing: 0 },
  ringText: { textTransform: 'none', letterSpacing: 0 },
  clip: { position: 'absolute', top: 0, overflow: 'hidden' },
  left0: { left: 0 },
  abs: { position: 'absolute', top: 0 },
  hole: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
