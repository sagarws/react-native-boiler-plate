import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  BUBBLE_OPACITY,
  BUBBLE_SIZE,
  FloatingActionPicker,
  OverlayNoticeBanner,
  screenOcrService,
  useCaptureSettings,
  type UseOverlayController,
} from '@/features/capture';
import { Button, Card, ListRow, StatusPill } from '@/shared/components';
import { useTheme } from '@/theme';
import { SettingSwitch, SliderRow } from './SettingControls';

export interface FloatingButtonSectionProps {
  overlay: UseOverlayController;
  onResetPosition: () => void;
}

/** Overlay on/off and permission, click action, size, opacity, position. */
export function FloatingButtonSection({
  overlay,
  onResetPosition,
}: FloatingButtonSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { settings, update } = useCaptureSettings();

  const onToggle = useCallback(
    (on: boolean) => {
      if (!on) overlay.disable();
      else if (!overlay.status.overlayPermission) overlay.openOverlaySettings();
      else void overlay.enable();
    },
    [overlay],
  );

  const reset = useCallback(() => {
    screenOcrService.resetBubblePosition();
    onResetPosition();
  }, [onResetPosition]);

  const opacityPercent = Math.round(settings.bubbleOpacity * 100);

  return (
    <View style={{ gap: spacing.sm }} testID="settings-floating">
      <Text
        accessibilityRole="header"
        style={[
          typography.overline,
          { color: colors.textSecondary, marginLeft: spacing.xs },
        ]}
      >
        {t('settings.sectionFloating')}
      </Text>
      <OverlayNoticeBanner controller={overlay} />
      <Card flat>
        <ListRow
          icon="scanText"
          title={t('settings.floatingEnabled')}
          subtitle={t('settings.floatingEnabledHint')}
          disabled={!overlay.status.supported || overlay.busy}
          right={
            <SettingSwitch
              testID="settings-overlay-switch"
              value={overlay.status.serviceRunning}
              onChange={onToggle}
              label={t('settings.floatingEnabled')}
            />
          }
        />
        <ListRow
          divider
          icon="layers"
          title={t('settings.overlayPermission')}
          right={
            overlay.status.overlayPermission ? (
              <StatusPill label={t('settings.granted')} tone="success" />
            ) : (
              <Button
                size="sm"
                variant="soft"
                label={t('settings.grant')}
                onPress={overlay.openOverlaySettings}
                style={styles.inline}
              />
            )
          }
        />
      </Card>

      <Text
        style={[
          typography.label,
          { color: colors.textPrimary, marginTop: spacing.sm },
        ]}
      >
        {t('action.label')}
      </Text>
      <FloatingActionPicker
        value={settings.action}
        onChange={action => update({ action })}
      />

      <Card flat style={{ marginTop: spacing.sm }}>
        <SliderRow
          divider={false}
          testID="settings-bubble-size"
          label={t('settings.bubbleSize')}
          valueText={t('settings.bubbleSizeValue', {
            value: settings.bubbleSizeDp,
          })}
          value={settings.bubbleSizeDp}
          min={BUBBLE_SIZE.min}
          max={BUBBLE_SIZE.max}
          step={BUBBLE_SIZE.step}
          onChange={bubbleSizeDp => update({ bubbleSizeDp })}
        />
        <SliderRow
          testID="settings-bubble-opacity"
          label={t('settings.bubbleOpacity')}
          valueText={t('settings.bubbleOpacityValue', {
            value: opacityPercent,
          })}
          value={opacityPercent}
          min={BUBBLE_OPACITY.min * 100}
          max={BUBBLE_OPACITY.max * 100}
          step={BUBBLE_OPACITY.step * 100}
          onChange={percent => update({ bubbleOpacity: percent / 100 })}
        />
        <ListRow
          divider
          icon="rotateCcw"
          title={t('settings.resetPosition')}
          onPress={reset}
          testID="settings-reset-position"
        />
      </Card>
      <Text
        style={[
          typography.caption,
          { color: colors.textSecondary, marginHorizontal: spacing.xs },
        ]}
      >
        {t('settings.floatingRestrictions')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  inline: { alignSelf: 'auto' },
});
