import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import {
  Button,
  Card,
  ChoiceList,
  Header,
  ListRow,
  Notice,
  StatusPill,
} from '@/shared/components';
import { formatDuration, logger } from '@/shared/utils';
import { useTheme } from '@/theme';
import {
  setRecorderBubble,
  useRecorderConfig,
  useRecorderStatus,
  useRecordings,
} from '../hooks/useRecorder';
import { recorderNative } from '../services/recorder.service';
import { isBusy, isCapturing } from '../services/recordings';
import { RECORDER_MODES, type RecordingStateId } from '../recorder.types';
import { SwitchRow } from '../components/RecorderRows';

const MODE_ICONS = {
  screenshot: 'camera',
  screen: 'monitor',
  voice: 'audioLines',
  screen_voice: 'layers',
} as const;

const tone = (s: RecordingStateId) =>
  s === 'recording'
    ? 'error'
    : s === 'paused' || s === 'merging' || s === 'verifying_output'
    ? 'warning'
    : s === 'failed'
    ? 'error'
    : s === 'completed'
    ? 'success'
    : 'neutral';

/**
 * Utility → Screen Recorder: turn the recording button on, pick what a tap
 * does, start/stop from here too, and see the live session (elapsed time,
 * part number, what is captured, merge progress). The button and the
 * recording run in a native service, separate from the OCR button.
 */
export default function RecorderScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, scheme } = useTheme();
  const navigation = useNavigation();
  const { status, elapsedMs, lastError, dismissError, refresh } =
    useRecorderStatus();
  const { config, update } = useRecorderConfig();
  const { recordings } = useRecordings();
  const [overlayNotice, setOverlayNotice] = useState(false);
  const available = recorderNative.available();

  useEffect(() => {
    recorderNative.syncTheme(scheme === 'dark', colors.primary);
  }, [scheme, colors.primary]);

  const capturing = isCapturing(status.state);
  const busy = isBusy(status.state);
  const interrupted = recordings.filter(r => r.status === 'interrupted').length;

  const toggleBubble = async (on: boolean) => {
    if (!on && capturing) {
      Alert.alert(
        t('recorder.hideWhileRecordingTitle'),
        t('recorder.hideWhileRecording'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('recorder.hideButton'),
            onPress: () => {
              void setRecorderBubble(false).then(refresh);
            },
          },
        ],
      );
      return;
    }
    const outcome = await setRecorderBubble(on);
    setOverlayNotice(outcome === 'overlay_permission');
    await refresh();
  };

  const start = () => {
    try {
      recorderNative.run(config.mode);
    } catch (error) {
      logger.warn('recorder start failed', (error as Error)?.message);
    }
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_recorder')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {!available ? (
          <Notice
            tone="warning"
            message={t('recorder.unsupported')}
            testID="rec-unsupported"
          />
        ) : null}
        {lastError ? (
          <Notice
            tone="error"
            message={t(`recorder.error_${lastError}`, {
              defaultValue: t('recorder.error_generic'),
            })}
            onDismiss={dismissError}
            testID="rec-error"
          />
        ) : null}
        {overlayNotice ? (
          <Notice
            tone="warning"
            title={t('recorder.overlayTitle')}
            message={t('recorder.overlayBody')}
            action={{
              label: t('recorder.openOverlaySettings'),
              onPress: recorderNative.openOverlaySettings,
            }}
            onDismiss={() => setOverlayNotice(false)}
            testID="rec-overlay-notice"
          />
        ) : null}
        {interrupted > 0 ? (
          <Notice
            tone="warning"
            title={t('recorder.interruptedTitle')}
            message={t('recorder.interruptedBody', { count: interrupted })}
            action={{
              label: t('recorder.review'),
              onPress: () =>
                navigation.navigate(ROUTES.UTILITY_RECORDINGS, {
                  filter: 'interrupted',
                }),
            }}
            testID="rec-interrupted"
          />
        ) : null}

        <Card testID="rec-status">
          <View style={{ gap: spacing.sm }}>
            <View style={styles.between}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('recorder.status')}
              </Text>
              <StatusPill
                tone={tone(status.state)}
                label={t(`recorder.state_${status.state}`)}
                testID="rec-state"
              />
            </View>
            {capturing ? (
              <>
                <Text
                  style={[typography.h1, { color: colors.textPrimary }]}
                  accessibilityLabel={t('recorder.elapsedA11y', {
                    time: formatDuration(elapsedMs / 1000),
                  })}
                  testID="rec-elapsed"
                >
                  {formatDuration(elapsedMs / 1000)}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('recorder.liveDetail', {
                    part: status.segment,
                    content: status.content,
                  })}
                </Text>
                <View style={[styles.row, { gap: spacing.sm }]}>
                  <Button
                    size="sm"
                    variant="secondary"
                    iconName={status.state === 'paused' ? 'play' : undefined}
                    label={
                      status.state === 'paused'
                        ? t('recorder.resume')
                        : t('recorder.pause')
                    }
                    onPress={recorderNative.pauseResume}
                    testID="rec-pause"
                  />
                  <Button
                    size="sm"
                    variant="danger"
                    label={t('recorder.stop')}
                    onPress={recorderNative.stop}
                    testID="rec-stop"
                  />
                </View>
              </>
            ) : status.state === 'merging' ||
              status.state === 'verifying_output' ? (
              <Text
                style={[typography.body, { color: colors.textSecondary }]}
                testID="rec-merging"
              >
                {t('recorder.mergingProgress', {
                  percent: Math.round(status.mergeProgress * 100),
                })}
              </Text>
            ) : (
              <Text style={[typography.body, { color: colors.textSecondary }]}>
                {t('recorder.idleHint')}
              </Text>
            )}
          </View>
        </Card>

        <Card flat>
          <SwitchRow
            icon="power"
            title={t('recorder.enableButton')}
            subtitle={t('recorder.enableButtonHint')}
            value={status.bubbleShown}
            onChange={on => {
              void toggleBubble(on);
            }}
            disabled={!available}
            testID="rec-enable-button"
          />
          {status.captureHeld && !busy ? (
            <ListRow
              divider
              icon="x"
              title={t('recorder.endCapture')}
              subtitle={t('recorder.endCaptureHint')}
              onPress={recorderNative.endCapture}
              testID="rec-end-capture"
            />
          ) : null}
        </Card>

        <Text
          accessibilityRole="header"
          style={[typography.overline, { color: colors.textSecondary }]}
        >
          {t('recorder.tapAction')}
        </Text>
        <ChoiceList
          accessibilityLabel={t('recorder.tapAction')}
          testID="rec-mode"
          value={config.mode}
          onChange={mode => {
            void update({ mode });
          }}
          choices={RECORDER_MODES.map(m => ({
            value: m,
            title: t(`recorder.mode_${m}`),
            description: t(`recorder.modeDesc_${m}`),
            icon: MODE_ICONS[m],
          }))}
        />
        <Button
          label={t(`recorder.start_${config.mode}`)}
          iconName={MODE_ICONS[config.mode]}
          onPress={start}
          disabled={!available || busy}
          testID="rec-start"
        />
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('recorder.privacy')}
        </Text>

        <Card flat>
          <ListRow
            icon="history"
            title={t('recorder.library')}
            subtitle={t('recorder.libraryCount', { count: recordings.length })}
            chevron
            onPress={() => navigation.navigate(ROUTES.UTILITY_RECORDINGS)}
            testID="rec-open-library"
          />
          <ListRow
            divider
            icon="slidersHorizontal"
            title={t('recorder.settings')}
            subtitle={t('recorder.settingsHint')}
            chevron
            onPress={() =>
              navigation.navigate(ROUTES.SETTINGS, { tab: 'recording' })
            }
            testID="rec-open-settings"
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
