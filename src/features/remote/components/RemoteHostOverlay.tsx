import React, { useEffect, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice, SegmentedControl } from '@/shared/components';
import { useTheme } from '@/theme';
import { SESSION_MINUTES } from '../core/constants';
import { displayDeviceId, formatRemaining } from '../core/ids';
import {
  remoteActions,
  useNow,
  useRemoteSettings,
  useRemoteState,
} from '../hooks/useRemote';
import type { RemotePermission, SessionMinutes } from '../types';
import { minutesLabel } from '../utils/labels';

/**
 * Mounted once at the app root. Starts Remote Access, asks the person holding
 * the phone to accept or decline an incoming request (with the verification
 * code), and — while someone views or controls this phone — keeps a bar with
 * who it is, the time left and Stop on every screen. There is no hidden mode.
 */
export function RemoteHostOverlay() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const settings = useRemoteSettings();
  const { host } = useRemoteState();
  const request = host.request;
  const session = host.session;
  const now = useNow(request !== null || session !== null);
  const [permission, setPermission] = useState<RemotePermission>('control');
  const [minutes, setMinutes] = useState<SessionMinutes>(
    settings.defaultMinutes,
  );

  useEffect(() => {
    remoteActions.start();
  }, []);

  useEffect(() => {
    if (!request) return;
    setPermission(request.requestedPermission);
    setMinutes(settings.defaultMinutes);
  }, [request, settings.defaultMinutes]);

  const service = remoteActions.host();

  // Android Back on the prompt = Decline.
  useEffect(() => {
    if (!request) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      service.answer(request.requestId, null);
      return true;
    });
    return () => sub.remove();
  }, [request, service]);

  return (
    <>
      {session ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.barWrap,
            { bottom: bottom + spacing.lg, paddingHorizontal: spacing.md },
          ]}
        >
          <View
            style={[
              styles.bar,
              {
                backgroundColor:
                  session.permission === 'control'
                    ? colors.error
                    : colors.warning,
                borderRadius: radius.pill,
                paddingLeft: spacing.md,
                paddingRight: spacing.xs,
                paddingVertical: spacing.xs,
                gap: spacing.sm,
              },
            ]}
            accessibilityLiveRegion="polite"
          >
            <Text
              style={[
                typography.caption,
                styles.flex,
                { color: colors.primaryForeground },
              ]}
              numberOfLines={1}
            >
              {(session.permission === 'control'
                ? t('remote.hostBar.controlling', { name: session.peer.name })
                : t('remote.hostBar.viewing', { name: session.peer.name })) +
                (session.expiresAt
                  ? ` · ${formatRemaining(session.expiresAt - now)}`
                  : '')}
            </Text>
            <Pressable
              onPress={() => service.stopSession()}
              accessibilityRole="button"
              accessibilityLabel={t('remote.hostBar.stop')}
              style={[
                styles.stop,
                {
                  backgroundColor: colors.surface,
                  borderRadius: radius.pill,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                },
              ]}
              testID="remote-hostbar-stop"
            >
              <Text style={[typography.label, { color: colors.error }]}>
                {t('remote.hostBar.stop')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* An in-tree layer, not <Modal>: on Android a Modal could stay hidden
          after the screen-capture consent screen had covered the app. */}
      {request ? (
        <View
          style={[
            styles.backdrop,
            {
              backgroundColor: colors.overlay,
              padding: spacing.lg,
              paddingTop: top + spacing.lg,
              paddingBottom: bottom + spacing.lg,
            },
          ]}
        >
          {request ? (
            <ScrollView
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderRadius: radius.xl },
              ]}
              contentContainerStyle={{ padding: spacing.xl, gap: spacing.md }}
              testID="remote-request"
            >
              <Text style={[typography.h2, { color: colors.textPrimary }]}>
                {t('remote.request.title')}
              </Text>
              <Text style={[typography.body, { color: colors.textPrimary }]}>
                {t('remote.request.body', {
                  name: request.peerName,
                  what:
                    request.requestedPermission === 'control'
                      ? t('remote.request.whatControl')
                      : t('remote.request.whatView'),
                })}
              </Text>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t('remote.request.device', {
                  id: displayDeviceId(request.peerId),
                  os: request.peerOs || '—',
                })}
                {'\n'}
                {t('remote.request.address', { address: request.address })}
              </Text>
              {request.firstTime ? (
                <Notice
                  tone="warning"
                  message={t('remote.request.firstTime')}
                />
              ) : null}
              <View
                style={[
                  styles.code,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.lg,
                    padding: spacing.md,
                  },
                ]}
              >
                <Text
                  style={[typography.overline, { color: colors.textSecondary }]}
                >
                  {t('remote.request.code')}
                </Text>
                <Text
                  style={[
                    typography.h1,
                    styles.codeText,
                    { color: colors.primary },
                  ]}
                >
                  {request.verificationCode}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('remote.request.codeHint')}
                </Text>
              </View>
              {request.requestedPermission === 'control' ? (
                <>
                  <Text
                    style={[typography.label, { color: colors.textPrimary }]}
                  >
                    {t('remote.request.permission')}
                  </Text>
                  <SegmentedControl
                    value={permission}
                    onChange={setPermission}
                    accessibilityLabel={t('remote.request.permission')}
                    options={[
                      {
                        value: 'control',
                        label: t('remote.request.permissionControl'),
                      },
                      {
                        value: 'view',
                        label: t('remote.request.permissionView'),
                      },
                    ]}
                  />
                </>
              ) : null}
              {permission === 'control' && !host.controlService ? (
                <Notice tone="info" message={t('remote.request.controlOff')} />
              ) : null}
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('remote.request.duration')}
              </Text>
              <View style={[styles.wrap, { gap: spacing.xs }]}>
                {SESSION_MINUTES.map(m => (
                  <Pressable
                    key={m}
                    onPress={() => setMinutes(m)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: minutes === m }}
                    style={[
                      styles.pill,
                      {
                        borderRadius: radius.pill,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.xs,
                        borderColor:
                          minutes === m ? colors.primary : colors.border,
                        backgroundColor:
                          minutes === m ? colors.primary : colors.surface,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.caption,
                        {
                          color:
                            minutes === m
                              ? colors.primaryForeground
                              : colors.textPrimary,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {minutesLabel(t, m)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t('remote.request.expires', {
                  seconds: Math.max(
                    0,
                    Math.ceil((request.expiresAt - now) / 1000),
                  ),
                })}
              </Text>
              <View style={[styles.actions, { gap: spacing.sm }]}>
                <Button
                  label={t('remote.request.decline')}
                  variant="secondary"
                  style={styles.flex}
                  onPress={() => service.answer(request.requestId, null)}
                  testID="remote-request-decline"
                />
                <Button
                  label={t('remote.request.accept')}
                  style={styles.flex}
                  onPress={() =>
                    service.answer(request.requestId, { permission, minutes })
                  }
                  testID="remote-request-accept"
                />
              </View>
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  barWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 520,
    width: '100%',
  },
  stop: {},
  flex: { flex: 1 },
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  card: { maxHeight: '90%' },
  code: { alignItems: 'center', gap: 2 },
  codeText: { letterSpacing: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: { borderWidth: StyleSheet.hairlineWidth, flexShrink: 0 },
  actions: { flexDirection: 'row' },
});
