import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { IconName } from '@/shared/assets';
import { Card, Icon } from '@/shared/components';
import { useTheme } from '@/theme';

const STEPS: readonly { icon: IconName; key: 'step1' | 'step2' | 'step3' }[] = [
  { icon: 'power', key: 'step1' },
  { icon: 'pointer', key: 'step2' },
  { icon: 'clipboardCheck', key: 'step3' },
];

/** The three-step "how it works" guide. */
export function StepsGuide() {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();

  return (
    <Card>
      <Text
        style={[
          typography.overline,
          { color: colors.textSecondary, marginBottom: spacing.md },
        ]}
      >
        {t('home.howItWorks')}
      </Text>
      {STEPS.map((step, index) => (
        <View
          key={step.key}
          style={[styles.step, index > 0 && { marginTop: spacing.md }]}
        >
          <View
            style={[
              styles.number,
              {
                backgroundColor: colors.primarySoft,
                borderRadius: radius.pill,
              },
            ]}
          >
            <Icon name={step.icon} size={18} color={colors.primaryText} />
          </View>
          <View style={[styles.text, { marginLeft: spacing.md }]}>
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {index + 1}. {t(`home.${step.key}Title`)}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t(`home.${step.key}Body`)}
            </Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center' },
  number: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
});
