import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  MAX_PAGES,
  PAGE_LOAD_DELAY,
  paginationService,
  speechService,
  useCaptureSettings,
  usePaginationTarget,
  useSpeechInfo,
  VERIFY_TIMEOUT,
} from '@/features/capture';
import {
  Button,
  ExpandableCard,
  ListRow,
  Notice,
  StatusPill,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { SliderRow } from './SettingControls';

type Message = 'needsOverlay' | 'pickerShown' | null;

/**
 * Speak with pagination: the pinned Next button (status, locate/reposition,
 * clear), page-turn timing and limits, and the accessibility permission the
 * page turns need.
 */
export interface PaginationSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

export function PaginationSection({
  expanded,
  onToggle,
}: PaginationSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { settings, updatePagination } = useCaptureSettings();
  const p = settings.pagination;
  const { target, clear } = usePaginationTarget();
  const { info } = useSpeechInfo(settings.speech.preferGoogle);
  const permissionOn = info?.scrollServiceEnabled === true;
  const [message, setMessage] = useState<Message>(null);

  const locate = useCallback(async () => {
    const outcome = await paginationService.startCalibration();
    setMessage(outcome === 'started' ? 'pickerShown' : 'needsOverlay');
  }, []);

  const onClear = useCallback(() => {
    Alert.alert(
      t('pagination.clearConfirmTitle'),
      t('pagination.clearConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('pagination.clear'), style: 'destructive', onPress: clear },
      ],
    );
  }, [clear, t]);

  const problem = target && target.problem !== 'none' ? target.problem : null;
  const summary = !target
    ? t('pagination.summaryNotSet')
    : problem
    ? t('pagination.summaryNeedsRepin')
    : t('pagination.summaryPinned', {
        anchor: t(`pagination.anchor_${target.anchor}`),
      });

  return (
    <ExpandableCard
      title={t('pagination.section')}
      summary={summary}
      icon="bookOpen"
      expanded={expanded}
      onToggle={onToggle}
      footer={t('pagination.controls')}
      testID="settings-pagination"
    >
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {t('pagination.intro')}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('pagination.howTo')}
        </Text>
      </View>

      <ListRow
        divider
        icon="crosshair"
        title={t('pagination.target')}
        subtitle={
          target
            ? [
                t('pagination.configured', {
                  anchor: t(`pagination.anchor_${target.anchor}`),
                }),
                target.packageName
                  ? t('pagination.savedFor', { app: target.packageName })
                  : null,
                target.hasNode
                  ? t('pagination.exactClick')
                  : t('pagination.pointClick'),
              ]
                .filter(Boolean)
                .join('\n')
            : t('pagination.notSet')
        }
        right={
          <StatusPill
            testID="pagination-target-status"
            label={
              !target
                ? t('pagination.notSet')
                : problem
                ? t('pagination.reposition')
                : t('reading.serviceOn')
            }
            tone={!target ? 'neutral' : problem ? 'warning' : 'success'}
          />
        }
      />
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg,
          gap: spacing.sm,
        }}
      >
        {problem ? (
          <Notice
            testID="pagination-target-problem"
            tone="warning"
            message={t(`pagination.problem_${problem}`)}
          />
        ) : null}
        {message ? (
          <Notice
            testID={`pagination-${message}`}
            tone={message === 'pickerShown' ? 'success' : 'info'}
            message={t(`pagination.${message}`)}
            onDismiss={() => setMessage(null)}
          />
        ) : null}
        <View style={[styles.buttons, { gap: spacing.sm }]}>
          <Button
            testID="pagination-locate"
            size="sm"
            iconName="crosshair"
            label={target ? t('pagination.reposition') : t('pagination.locate')}
            onPress={() => {
              void locate();
            }}
            style={styles.flex}
          />
          {target ? (
            <Button
              testID="pagination-clear"
              size="sm"
              variant="secondary"
              iconName="trash2"
              label={t('pagination.clear')}
              onPress={onClear}
              style={styles.flex}
            />
          ) : null}
        </View>
        <Text
          style={[
            typography.label,
            { color: colors.textPrimary, marginTop: spacing.sm },
          ]}
        >
          {t('pagination.modesTitle')}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('pagination.modes')}
        </Text>
      </View>

      <ListRow
        divider
        icon="accessibility"
        title={t('pagination.permission')}
        subtitle={t('pagination.permissionWhy')}
        right={
          <StatusPill
            testID="pagination-permission"
            label={
              permissionOn ? t('reading.serviceOn') : t('reading.serviceOff')
            }
            tone={permissionOn ? 'success' : 'warning'}
          />
        }
      />
      {!permissionOn ? (
        <View
          style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
        >
          <Button
            size="sm"
            variant="soft"
            iconName="accessibility"
            label={t('reading.openAccessibility')}
            onPress={speechService.openAccessibilitySettings}
            testID="pagination-open-accessibility"
          />
        </View>
      ) : null}

      <SliderRow
        testID="pagination-load-delay"
        label={t('pagination.pageLoadDelay')}
        valueText={t('pagination.seconds', {
          value: (p.pageLoadDelayMs / 1000).toFixed(2),
        })}
        value={p.pageLoadDelayMs}
        min={PAGE_LOAD_DELAY.min}
        max={PAGE_LOAD_DELAY.max}
        step={PAGE_LOAD_DELAY.step}
        onChange={pageLoadDelayMs => updatePagination({ pageLoadDelayMs })}
      />
      <SliderRow
        testID="pagination-verify-timeout"
        label={t('pagination.verifyTimeout')}
        valueText={t('pagination.seconds', { value: p.verifyTimeoutMs / 1000 })}
        value={p.verifyTimeoutMs}
        min={VERIFY_TIMEOUT.min}
        max={VERIFY_TIMEOUT.max}
        step={VERIFY_TIMEOUT.step}
        onChange={verifyTimeoutMs => updatePagination({ verifyTimeoutMs })}
      />
      <SliderRow
        testID="pagination-max-pages"
        label={t('pagination.maxPages')}
        valueText={t('pagination.maxPagesValue', { value: p.maxPages })}
        value={p.maxPages}
        min={MAX_PAGES.min}
        max={MAX_PAGES.max}
        step={MAX_PAGES.step}
        onChange={maxPages => updatePagination({ maxPages })}
      />
    </ExpandableCard>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row' },
  flex: { flex: 1 },
});
