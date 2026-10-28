import React from 'react';
import { TabBar } from '@/shared/components';

export type SettingsTab = 'general' | 'ocr' | 'files';

export interface SettingsTabsProps {
  value: SettingsTab;
  onChange: (tab: SettingsTab) => void;
  tabs: { value: SettingsTab; label: string }[];
  accessibilityLabel: string;
}

/** The General / OCR / File Management switcher at the top of Settings. */
export function SettingsTabs(props: SettingsTabsProps) {
  return <TabBar {...props} testID="settings-tab" />;
}
