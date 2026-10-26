import React from 'react';
import { useTranslation } from 'react-i18next';
import type { IconName } from '@/shared/assets';
import { ChoiceList } from '@/shared/components';
import { FLOATING_ACTIONS, type FloatingAction } from '../capture.types';

const ICONS: Record<FloatingAction, IconName> = {
  copy: 'copy',
  speak: 'volume2',
  speak_scroll: 'scrollText',
};

export interface FloatingActionPickerProps {
  value: FloatingAction;
  onChange: (action: FloatingAction) => void;
}

/** Copy text only · Start speaking · Speak with auto-scroll. */
export function FloatingActionPicker({
  value,
  onChange,
}: FloatingActionPickerProps) {
  const { t } = useTranslation();
  return (
    <ChoiceList
      testID="floating-action"
      accessibilityLabel={t('action.label')}
      value={value}
      onChange={onChange}
      choices={FLOATING_ACTIONS.map(action => ({
        value: action,
        title: t(`action.${action}`),
        description: t(`action.${action}_description`),
        icon: ICONS[action],
      }))}
    />
  );
}
