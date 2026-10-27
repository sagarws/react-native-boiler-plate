import React, { type PropsWithChildren } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import type { IconName } from '@/shared/assets';
import { useTheme } from '@/theme';
import { Icon } from '../Icon';

// Old-architecture Android needs this opt-in for LayoutAnimation; harmless otherwise.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type ExpandableCardProps = PropsWithChildren<{
  title: string;
  /** One-line state shown under the title (actual values, not static text). */
  summary?: string;
  icon?: IconName;
  expanded: boolean;
  onToggle: () => void;
  /** Explanatory text under the card, shown while expanded. */
  footer?: string;
  /** Pad the body, for content that is not a list of rows. */
  padded?: boolean;
  testID?: string;
}>;

/** Animates the next layout change (expand/collapse) with a short ease. */
export function animateNextLayout(): void {
  LayoutAnimation.configureNext(
    LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'),
  );
}

/**
 * A settings card that collapses to a single header row. The body is only
 * rendered while expanded, so a collapsed card costs nothing; its settings
 * live in the store, so collapsing never changes them.
 */
export function ExpandableCard({
  title,
  summary,
  icon,
  expanded,
  onToggle,
  footer,
  padded = false,
  testID,
  children,
}: ExpandableCardProps) {
  const { colors, typography, radius, spacing } = useTheme();

  const toggle = () => {
    animateNextLayout();
    onToggle();
  };

  return (
    <View testID={testID} style={{ gap: spacing.sm }}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: expanded ? colors.primary : colors.border,
            borderRadius: radius.xl,
          },
        ]}
      >
        <Pressable
          testID={testID ? `${testID}-header` : undefined}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint={summary}
          accessibilityState={{ expanded }}
          onPress={toggle}
          android_ripple={{ color: colors.primarySoft }}
          style={({ pressed }) => [
            styles.header,
            { padding: spacing.lg, gap: spacing.md },
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}
        >
          {icon ? (
            <View
              style={[
                styles.iconWell,
                {
                  backgroundColor: colors.primarySoft,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Icon name={icon} size={18} color={colors.primaryText} />
            </View>
          ) : null}
          <View style={styles.text}>
            <Text style={[typography.title, { color: colors.textPrimary }]}>
              {title}
            </Text>
            {summary ? (
              <Text
                numberOfLines={1}
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {summary}
              </Text>
            ) : null}
          </View>
          <Icon
            name="chevronRight"
            size={20}
            color={colors.placeholder}
            style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
          />
        </Pressable>
        {expanded ? (
          <View
            style={[
              {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.divider,
              },
              padded && { padding: spacing.lg },
            ]}
          >
            {children}
          </View>
        ) : null}
      </View>
      {expanded && footer ? (
        <Text
          style={[
            typography.caption,
            { color: colors.textSecondary, marginHorizontal: spacing.xs },
          ]}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 64 },
  iconWell: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
});
