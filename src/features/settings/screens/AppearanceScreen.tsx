import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Header, StatusPill } from '@/shared/components';
import { useTheme } from '@/theme';
import { SettingsSection } from '../components/SettingsSection';
import { ThemeModeControl } from '../components/ThemeModeControl';
import { ThemePresetGrid } from '../components/ThemePresetGrid';
import { TypographyPicker } from '../components/TypographyPicker';

/** Theme colours, light/dark mode and the two text styles, with a live preview. */
export default function AppearanceScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('appearance.title')} />
      <ScrollView
        testID="appearance-scroll"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.xl,
        }}
      >
        <View style={{ gap: spacing.sm }}>
          <Text
            style={[
              typography.overline,
              { color: colors.textSecondary, marginLeft: spacing.xs },
            ]}
          >
            {t('appearance.preview')}
          </Text>
          {/* Rendered from the live theme, so every change shows here at once. */}
          <Card testID="appearance-preview" style={{ gap: spacing.md }}>
            <StatusPill label={t('ocrMode.mixed')} tone="primary" />
            <Text style={[typography.h2, { color: colors.textPrimary }]}>
              {t('appearance.previewHeading')}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {t('appearance.previewBody')}
            </Text>
            <Button
              label={t('appearance.previewButton')}
              iconName="copy"
              onPress={() => undefined}
            />
          </Card>
        </View>

        <SettingsSection title={t('appearance.mode')} padded>
          <ThemeModeControl />
        </SettingsSection>

        <SettingsSection title={t('appearance.colors')} padded>
          <ThemePresetGrid />
        </SettingsSection>

        <SettingsSection title={t('appearance.textStyle')} padded>
          <TypographyPicker />
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
