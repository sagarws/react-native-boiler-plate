import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChoiceList } from '@/shared/components';
import { OCR_MODES, type OcrMode } from '../capture.types';

export interface OcrModePickerProps {
  value: OcrMode;
  onChange: (mode: OcrMode) => void;
}

/** The seven OCR language modes, each with what it is best for. */
export function OcrModePicker({ value, onChange }: OcrModePickerProps) {
  const { t } = useTranslation();
  return (
    <ChoiceList
      testID="ocr-mode"
      accessibilityLabel={t('ocrMode.label')}
      value={value}
      onChange={onChange}
      choices={OCR_MODES.map(mode => ({
        value: mode,
        title: t(`ocrMode.${mode}`),
        description: t(`ocrMode.${mode}_description`),
        badge: t(`ocrMode.${mode}_short`),
      }))}
    />
  );
}
