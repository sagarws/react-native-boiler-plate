import React, { useCallback } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { Button, Card, Header, Icon, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import {
  formatDuration,
  LiveInfoCard,
  SettingsCard,
  ShareCard,
} from '../components/LiveCameraCards';
import {
  liveCameraActions,
  useElapsed,
  useLiveCamera,
  useLiveCameraSettings,
} from '../hooks/useLiveCamera';

/**
 * Share Live Camera: the phone's camera as a live webcam anyone can watch in
 * a browser through a link. Preview + Start/Stop on top, then live info,
 * share controls and settings. The stream keeps running when the screen or
 * the app is left (foreground service); the camera is released otherwise.
 */
export default function LiveCameraScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const state = useLiveCamera();
  const settings = useLiveCameraSettings();
  const elapsed = useElapsed(state.startedAt);

  useFocusEffect(
    useCallback(() => {
      liveCameraActions.openPreview();
      return () => liveCameraActions.closePreview();
    }, []),
  );

  const streaming =
    state.phase === 'live' ||
    state.phase === 'reconnecting' ||
    state.phase === 'starting';
  const canSwitch =
    !!state.previewUrl &&
    (!state.cameras || (state.cameras.front && state.cameras.back));

  return (
    <View
      style={[
        styles.flex,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('liveCamera.title')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Preview */}
        <View
          style={[
            styles.preview,
            { borderRadius: radius.lg, backgroundColor: '#000' },
          ]}
          testID="live-preview"
        >
          {state.previewUrl ? (
            <RTCView
              streamURL={state.previewUrl}
              objectFit="cover"
              mirror={state.facing === 'front'}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Icon name="camera" size={40} color="#888" />
              <Text style={[typography.caption, styles.previewText]}>
                {state.permission === 'denied' || state.permission === 'blocked'
                  ? t('liveCamera.permissionNeeded')
                  : t('liveCamera.cameraOff')}
              </Text>
            </View>
          )}

          {streaming ? (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    state.phase === 'live' ? '#e5484d' : colors.warning,
                },
              ]}
            >
              <Text style={styles.badgeText}>
                {state.phase === 'live'
                  ? `● LIVE${
                      elapsed !== null ? ` ${formatDuration(elapsed)}` : ''
                    }`
                  : t(`liveCamera.phase.${state.phase}`)}
              </Text>
            </View>
          ) : null}

          {canSwitch ? (
            <Pressable
              onPress={liveCameraActions.switchCamera}
              accessibilityRole="button"
              accessibilityLabel={t('liveCamera.switchCamera')}
              style={styles.switchBtn}
              hitSlop={8}
              testID="live-switch"
            >
              <Icon name="rotateCw" size={22} color="#fff" />
            </Pressable>
          ) : null}
        </View>

        {state.permission === 'blocked' ? (
          <Button
            label={t('liveCamera.openSettings')}
            variant="secondary"
            onPress={() => Linking.openSettings()}
          />
        ) : null}

        {state.error ? (
          <Pressable onPress={liveCameraActions.clearError}>
            <Notice
              tone="error"
              message={t(`liveCamera.errors.${state.error}`)}
            />
          </Pressable>
        ) : null}
        {state.backgroundWarning ? (
          <Notice tone="warning" message={t('liveCamera.backgroundWarning')} />
        ) : null}

        {streaming ? (
          <Button
            label={t('liveCamera.stop')}
            iconName="square"
            variant="secondary"
            onPress={liveCameraActions.stop}
            testID="live-stop"
          />
        ) : (
          <Button
            label={t('liveCamera.start')}
            iconName="play"
            onPress={liveCameraActions.start}
            disabled={!state.previewUrl && state.permission !== 'unknown'}
            testID="live-start"
          />
        )}
        {state.phase === 'starting' ? (
          <Text
            style={[
              typography.caption,
              { color: colors.textSecondary, textAlign: 'center' },
            ]}
          >
            {t('liveCamera.starting')}
          </Text>
        ) : null}

        {state.stream ? (
          <>
            <LiveInfoCard state={state} elapsed={elapsed} />
            <ShareCard stream={state.stream} busy={state.busy} />
          </>
        ) : (
          <Card>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {t('liveCamera.intro')}
            </Text>
          </Card>
        )}

        <SettingsCard settings={settings} live={!!state.stream} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  preview: { aspectRatio: 3 / 4, overflow: 'hidden', maxHeight: 460 },
  previewText: { color: '#aaa', marginTop: 8, textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  switchBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
