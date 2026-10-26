import React from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/shared/components';
import { themePreference, useTheme, type ThemePreference } from '@/theme';

const MODES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** System / Light / Dark. */
export function ThemeModeControl() {
  const { t } = useTranslation();
  const { preference } = useTheme();
  return (
    <SegmentedControl
      testID="theme-mode"
      accessibilityLabel={t('appearance.mode')}
      value={preference}
      onChange={themePreference.set}
      options={MODES.map(mode => ({
        value: mode,
        label: t(`settings.theme_${mode}`),
      }))}
    />
  );
}
