import React, { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  OcrModePicker,
  screenOcrService,
  useCaptureSettings,
} from '@/features/capture';
import { ThemeModeControl, ThemePresetGrid } from '@/features/settings';
import {
  BrandLogo,
  Button,
  Card,
  ListRow,
  StatusPill,
} from '@/shared/components';
import {
  isNotificationPermissionGranted,
  requestNotificationPermission,
} from '@/shared/utils';
import { useTheme } from '@/theme';
import { onboardingStore } from '../store/onboarding.store';

const STEPS = ['welcome', 'language', 'theme', 'permissions'] as const;
type Step = (typeof STEPS)[number];

/** Live status of the two permissions the permissions step asks for. */
function usePermissionStatus() {
  const [overlay, setOverlay] = useState(false);
  const [notifications, setNotifications] = useState(false);

  const refresh = useCallback(async () => {
    const [status, notif] = await Promise.all([
      screenOcrService.getStatus(),
      isNotificationPermissionGranted(),
    ]);
    setOverlay(status.overlayPermission);
    setNotifications(notif);
  }, []);

  useEffect(() => {
    void refresh();
    // The overlay permission is granted in system settings; re-check on return.
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const requestNotifications = useCallback(async () => {
    setNotifications(await requestNotificationPermission());
  }, []);

  return { overlay, notifications, requestNotifications, refresh };
}

/**
 * One-time setup: welcome → OCR language → theme → permissions. Every step
 * can be revisited later in Settings, so nothing here blocks "Get started".
 */
export default function OnboardingScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const { settings, update } = useCaptureSettings();
  const permissions = usePermissionStatus();
  const [index, setIndex] = useState(0);
  const step: Step = STEPS[index];
  const last = index === STEPS.length - 1;

  const next = () => (last ? onboardingStore.complete() : setIndex(i => i + 1));
  const back = () => setIndex(i => Math.max(0, i - 1));

  const titleKey = `onboarding.${step}Title` as const;
  const bodyKey = `onboarding.${step}Body` as const;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <View style={[styles.progress, { padding: spacing.lg, gap: spacing.xs }]}>
        {STEPS.map((s, i) => (
          <View
            key={s}
            style={[
              styles.dot,
              {
                borderRadius: radius.pill,
                backgroundColor: i <= index ? colors.primary : colors.border,
              },
            ]}
          />
        ))}
      </View>

      <ScrollView
        testID={`onboarding-${step}`}
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.lg,
          flexGrow: 1,
        }}
      >
        {step === 'welcome' ? (
          <BrandLogo size={72} variant="mark" style={styles.hero} />
        ) : null}
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('onboarding.step', { current: index + 1, total: STEPS.length })}
          </Text>
          <Text
            accessibilityRole="header"
            style={[typography.display, { color: colors.textPrimary }]}
          >
            {t(titleKey)}
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            {t(bodyKey)}
          </Text>
        </View>

        {step === 'language' ? (
          <OcrModePicker
            value={settings.ocrMode}
            onChange={ocrMode => update({ ocrMode })}
          />
        ) : null}

        {step === 'theme' ? (
          <View style={{ gap: spacing.lg }}>
            <ThemeModeControl />
            <ThemePresetGrid />
          </View>
        ) : null}

        {step === 'permissions' ? (
          <>
            <Card flat>
              <ListRow
                testID="onboarding-overlay"
                icon="layers"
                title={t('onboarding.overlayRow')}
                subtitle={t('about.permOverlayWhy')}
                right={
                  permissions.overlay ? (
                    <StatusPill
                      label={t('onboarding.allowed')}
                      tone="success"
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant="soft"
                      label={t('onboarding.allow')}
                      onPress={screenOcrService.openOverlaySettings}
                      style={styles.inline}
                    />
                  )
                }
              />
              <ListRow
                divider
                testID="onboarding-notifications"
                icon="bell"
                title={t('onboarding.notificationsRow')}
                subtitle={t('about.permNotificationsWhy')}
                right={
                  permissions.notifications ? (
                    <StatusPill
                      label={t('onboarding.allowed')}
                      tone="success"
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant="soft"
                      label={t('onboarding.allow')}
                      onPress={() => {
                        void permissions.requestNotifications();
                      }}
                      style={styles.inline}
                    />
                  )
                }
              />
            </Card>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('onboarding.skipForNow')}
            </Text>
          </>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            padding: spacing.lg,
            paddingBottom: Math.max(bottom, spacing.lg),
            gap: spacing.md,
          },
        ]}
      >
        {index > 0 ? (
          <Button
            label={t('common.back')}
            variant="ghost"
            onPress={back}
            style={styles.footerButton}
          />
        ) : null}
        <Button
          testID="onboarding-next"
          label={last ? t('onboarding.getStarted') : t('common.next')}
          onPress={next}
          style={styles.footerButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  progress: { flexDirection: 'row' },
  dot: { flex: 1, height: 4 },
  hero: { alignSelf: 'flex-start' },
  inline: { alignSelf: 'auto' },
  footer: { flexDirection: 'row' },
  footerButton: { flex: 1 },
});
