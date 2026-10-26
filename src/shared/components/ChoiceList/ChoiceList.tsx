import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { IconName } from '@/shared/assets';
import { useTheme } from '@/theme';
import { Icon } from '../Icon';

export interface Choice<T extends string> {
  value: T;
  title: string;
  description?: string;
  /** Short text badge ("HI·EN") or an icon on the left. */
  badge?: string;
  icon?: IconName;
}

export interface ChoiceListProps<T extends string> {
  choices: readonly Choice<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Names the group for screen readers. */
  accessibilityLabel: string;
  /** testID prefix; each option gets `${testID}-${value}`. */
  testID: string;
}

/** Single choice from a list of described options (radio cards). */
export function ChoiceList<T extends string>({
  choices,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: ChoiceListProps<T>) {
  const { colors, typography, radius, spacing } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{ gap: spacing.sm }}
    >
      {choices.map(choice => {
        const selected = choice.value === value;
        return (
          <Pressable
            key={choice.value}
            testID={`${testID}-${choice.value}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, selected }}
            accessibilityLabel={choice.title}
            accessibilityHint={choice.description}
            onPress={() => onChange(choice.value)}
            style={({ pressed }) => [
              styles.option,
              {
                borderRadius: radius.lg,
                padding: spacing.md,
                gap: spacing.md,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected
                  ? colors.primarySoft
                  : pressed
                  ? colors.surfaceMuted
                  : colors.surface,
              },
            ]}
          >
            {choice.badge || choice.icon ? (
              <View
                style={[
                  styles.badge,
                  {
                    borderRadius: radius.md,
                    backgroundColor: selected
                      ? colors.primary
                      : colors.surfaceMuted,
                  },
                ]}
              >
                {choice.icon ? (
                  <Icon
                    name={choice.icon}
                    size={18}
                    color={
                      selected ? colors.primaryForeground : colors.textSecondary
                    }
                  />
                ) : (
                  <Text
                    numberOfLines={1}
                    style={[
                      typography.caption,
                      {
                        color: selected
                          ? colors.primaryForeground
                          : colors.textSecondary,
                      },
                    ]}
                  >
                    {choice.badge}
                  </Text>
                )}
              </View>
            ) : null}
            <View style={styles.text}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {choice.title}
              </Text>
              {choice.description ? (
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {choice.description}
                </Text>
              ) : null}
            </View>
            <View
              style={[
                styles.radio,
                { borderColor: selected ? colors.primary : colors.placeholder },
                selected && { backgroundColor: colors.primary },
              ]}
            >
              {selected ? (
                <Icon name="check" size={14} color={colors.primaryForeground} />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    minHeight: 60,
  },
  badge: {
    minWidth: 52,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  text: { flex: 1 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
