import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  MAX_NO_NEW_TEXT,
  MAX_SECTIONS,
  speechService,
  useCaptureSettings,
  useSpeechInfo,
} from '@/features/capture';
import {
  Button,
  ExpandableCard,
  ListRow,
  StatusPill,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { SettingSwitch, SliderRow } from './SettingControls';

/**
 * Auto-scroll reading: the accessibility-service status (with a transparent
 * disclosure — the app never enables it), limits that stop endless scrolling,
 * and the manual-scroll fallback.
 */
export interface ReadingSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

export function ReadingSection({ expanded, onToggle }: ReadingSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { settings, updateReading } = useCaptureSettings();
  const reading = settings.reading;
  const { info } = useSpeechInfo(settings.speech.preferGoogle);
  const serviceOn = info?.scrollServiceEnabled === true;
  const summary = reading.autoScroll
    ? t('reading.summaryAuto', {
        permission: serviceOn
          ? t('reading.serviceOn')
          : t('reading.serviceOff'),
      })
    : t('reading.summaryManual');

  return (
    <ExpandableCard
      title={t('reading.section')}
      summary={summary}
      icon="scrollText"
      expanded={expanded}
      onToggle={onToggle}
      footer={t('reading.notAllApps')}
      testID="settings-reading"
    >
      <ListRow
        icon="scrollText"
        title={t('reading.autoScroll')}
        subtitle={t('reading.autoScrollHint')}
        right={
          <SettingSwitch
            testID="reading-auto-scroll"
            value={reading.autoScroll}
            onChange={autoScroll => updateReading({ autoScroll })}
            label={t('reading.autoScroll')}
          />
        }
      />
      <ListRow
        divider
        icon="accessibility"
        title={t('reading.service')}
        right={
          <View style={styles.row}>
            <StatusPill
              testID="reading-service-status"
              label={
                serviceOn ? t('reading.serviceOn') : t('reading.serviceOff')
              }
              tone={serviceOn ? 'success' : 'neutral'}
            />
          </View>
        }
      />
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg,
          gap: spacing.sm,
        }}
      >
        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {t('reading.disclosureTitle')}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('reading.disclosure')}
        </Text>
        <Button
          size="sm"
          variant="soft"
          iconName="accessibility"
          label={t('reading.openAccessibility')}
          onPress={speechService.openAccessibilitySettings}
          testID="reading-open-accessibility"
        />
      </View>
      <SliderRow
        testID="reading-max-sections"
        label={t('reading.maxSections')}
        valueText={t('reading.maxSectionsValue', {
          value: reading.maxSections,
        })}
        value={reading.maxSections}
        min={MAX_SECTIONS.min}
        max={MAX_SECTIONS.max}
        step={MAX_SECTIONS.step}
        onChange={maxSections => updateReading({ maxSections })}
      />
      <SliderRow
        testID="reading-max-no-new"
        label={t('reading.maxNoNewText')}
        valueText={t('reading.maxNoNewTextValue', {
          value: reading.maxNoNewText,
        })}
        value={reading.maxNoNewText}
        min={MAX_NO_NEW_TEXT.min}
        max={MAX_NO_NEW_TEXT.max}
        step={MAX_NO_NEW_TEXT.step}
        onChange={maxNoNewText => updateReading({ maxNoNewText })}
      />
      <ListRow
        divider
        icon="pointer"
        title={t('reading.manualFallback')}
        subtitle={t('reading.manualFallbackHint')}
        right={
          <SettingSwitch
            testID="reading-manual-fallback"
            value={reading.manualFallback}
            onChange={manualFallback => updateReading({ manualFallback })}
            label={t('reading.manualFallback')}
          />
        }
      />
    </ExpandableCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
