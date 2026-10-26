import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  OverlayNoticeBanner,
  type UseOverlayController,
} from '@/features/capture';
import { Button, Card, StatusPill } from '@/shared/components';
import { useTheme } from '@/theme';

export interface CaptureCardProps {
  controller: UseOverlayController;
}

/** Hero: heading, the floating-button switch and its live status. */
export function CaptureCard({ controller }: CaptureCardProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { status, busy, loading, enable, disable, openOverlaySettings } =
    controller;
  const running = status.serviceRunning;

  const onPress = () => {
    if (running) disable();
    else if (!status.overlayPermission) openOverlaySettings();
    else void enable();
  };

  return (
    <Card style={{ gap: spacing.md }}>
      <View>
        <Text
          accessibilityRole="header"
          style={[typography.display, { color: colors.textPrimary }]}
        >
          {t('home.heading')}
        </Text>
        <Text
          style={[
            typography.body,
            { color: colors.textSecondary, marginTop: spacing.xs },
          ]}
        >
          {t('home.subheading')}
        </Text>
      </View>

      {status.supported ? (
        <View style={[styles.pills, { gap: spacing.sm }]}>
          <StatusPill
            testID="status-overlay"
            label={running ? t('overlay.statusOn') : t('overlay.statusOff')}
            tone={running ? 'success' : 'neutral'}
          />
          <StatusPill
            testID="status-permission"
            label={
              status.overlayPermission
                ? t('overlay.permissionGranted')
                : t('overlay.permissionNeeded')
            }
            tone={status.overlayPermission ? 'success' : 'warning'}
          />
        </View>
      ) : null}

      <OverlayNoticeBanner controller={controller} />

      <Button
        testID="overlay-toggle"
        size="lg"
        iconName={running ? 'power' : 'scanText'}
        variant={running ? 'secondary' : 'primary'}
        label={
          busy
            ? t('overlay.starting')
            : running
            ? t('overlay.turnOff')
            : t('overlay.turnOn')
        }
        loading={busy}
        disabled={!status.supported || loading}
        onPress={onPress}
        accessibilityHint={running ? undefined : t('overlay.consentHint')}
      />
      {!running && status.supported && status.overlayPermission ? (
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('overlay.consentHint')}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap' },
});
