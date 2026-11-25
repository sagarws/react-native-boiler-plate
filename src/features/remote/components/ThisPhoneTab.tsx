import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, ListRow, Notice, StatusPill } from '@/shared/components';
import { useTheme } from '@/theme';
import { displayDeviceId, formatRemaining } from '../core/ids';
import {
  remoteActions,
  updateRemoteSettings,
  useNow,
  useRemoteSettings,
} from '../hooks/useRemote';
import type { RemoteState } from '../services/remote.service';
import { remoteNative } from '../services/native.service';
import { SettingSwitchRow } from './SettingSwitchRow';

export interface ThisPhoneTabProps {
  state: RemoteState;
  onOpenSettings: () => void;
}

/** This phone as the one being controlled: its ID, the switch, status, the live session, known devices. */
export function ThisPhoneTab({ state, onOpenSettings }: ThisPhoneTabProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const settings = useRemoteSettings();
  const host = state.host;
  const session = host.session;
  const now = useNow(session !== null);
  const service = remoteActions.host();

  const relayText =
    host.relay === 'online'
      ? t('remote.phone.relayOnline')
      : host.relay === 'connecting'
      ? t('remote.phone.relayConnecting')
      : host.relay === 'error'
      ? t('remote.phone.relayError', { error: host.relayError ?? '' })
      : t('remote.phone.relayOff');

  const peerActions = (id: string, name: string, blocked: boolean) =>
    Alert.alert(name, displayDeviceId(id), [
      blocked
        ? {
            text: t('remote.phone.unblock'),
            onPress: () => service.unblock(id),
          }
        : {
            text: t('remote.phone.block'),
            style: 'destructive',
            onPress: () => service.block(id),
          },
      ...(blocked
        ? []
        : [
            {
              text: t('remote.phone.forget'),
              onPress: () => service.forget(id),
            },
          ]),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);

  return (
    <>
      <Card>
        <View style={[styles.idCard, { padding: spacing.lg, gap: spacing.xs }]}>
          <Text style={[typography.overline, { color: colors.textSecondary }]}>
            {t('remote.phone.idLabel')}
          </Text>
          <Text
            style={[
              typography.display,
              styles.id,
              { color: colors.textPrimary },
            ]}
            selectable
            testID="remote-own-id"
            accessibilityLabel={state.identity.id.split('').join(' ')}
          >
            {displayDeviceId(state.identity.id)}
          </Text>
          <Text style={[typography.label, { color: colors.textPrimary }]}>
            {state.identity.name}
          </Text>
          <Text
            style={[
              typography.caption,
              styles.center,
              { color: colors.textSecondary },
            ]}
          >
            {t('remote.phone.idHint')}
          </Text>
          {state.addresses.length ? (
            <Text
              style={[
                typography.caption,
                styles.center,
                { color: colors.textSecondary },
              ]}
            >
              {t('remote.phone.addresses', {
                list: state.addresses.join(', '),
              })}
            </Text>
          ) : null}
          <Text
            style={[
              typography.caption,
              styles.mono,
              { color: colors.textSecondary },
            ]}
          >
            {t('remote.phone.fingerprint', { fp: state.identity.fingerprint })}
          </Text>
        </View>
      </Card>

      {!remoteNative.canHost ? (
        <Notice tone="info" message={t('remote.phone.iosUnsupported')} />
      ) : (
        <>
          <Card>
            <SettingSwitchRow
              label={t('remote.phone.allow')}
              hint={t('remote.phone.allowHint')}
              value={settings.allowIncoming}
              onChange={allowIncoming =>
                updateRemoteSettings({ allowIncoming })
              }
              testID="remote-allow-incoming"
            />
            {settings.allowIncoming ? (
              <>
                <ListRow
                  title={t('remote.phone.status')}
                  subtitle={
                    host.error
                      ? t('remote.phone.listenError', { error: host.error })
                      : host.listening
                      ? t('remote.phone.listening')
                      : t('remote.phone.notListening')
                  }
                  icon="globe"
                  divider
                  right={
                    <StatusPill
                      label={host.listening ? t('common.on') : t('common.off')}
                      tone={host.listening ? 'success' : 'neutral'}
                    />
                  }
                />
                <ListRow
                  title={t('remote.phone.relay')}
                  subtitle={relayText}
                  icon="cloud"
                  divider
                />
                <ListRow
                  title={t('remote.phone.control')}
                  subtitle={
                    host.controlService
                      ? t('remote.phone.controlOn')
                      : t('remote.phone.controlOff')
                  }
                  icon="mousePointerClick"
                  divider
                  right={
                    host.controlService ? (
                      <StatusPill label={t('common.on')} tone="success" />
                    ) : (
                      <Button
                        label={t('remote.phone.controlOpen')}
                        size="sm"
                        variant="soft"
                        onPress={remoteNative.openControlServiceSettings}
                      />
                    )
                  }
                  testID="remote-control-service"
                />
              </>
            ) : null}
          </Card>

          {session ? (
            <Card>
              <View style={{ padding: spacing.lg, gap: spacing.sm }}>
                <Text style={[typography.title, { color: colors.textPrimary }]}>
                  {t('remote.phone.sessionTitle', { name: session.peer.name })}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {[
                    session.permission === 'control'
                      ? t('remote.phone.sessionControl')
                      : t('remote.phone.sessionView'),
                    session.expiresAt
                      ? t('remote.viewer.timeLeft', {
                          time: formatRemaining(session.expiresAt - now),
                        })
                      : t('remote.phone.sessionNoLimit'),
                  ].join(' · ')}
                </Text>
                {session.state === 'reconnecting' ? (
                  <Notice
                    tone="warning"
                    message={t('remote.phone.sessionReconnecting', {
                      name: session.peer.name,
                    })}
                  />
                ) : null}
                <View style={[styles.actions, { gap: spacing.sm }]}>
                  <Button
                    label={
                      session.permission === 'control'
                        ? t('remote.phone.sessionMakeView')
                        : t('remote.phone.sessionMakeControl')
                    }
                    size="sm"
                    variant="secondary"
                    onPress={() =>
                      service.setSessionPermission(
                        session.permission === 'control' ? 'view' : 'control',
                      )
                    }
                  />
                  {session.expiresAt ? (
                    <Button
                      label={t('remote.phone.sessionExtend')}
                      size="sm"
                      variant="secondary"
                      onPress={() => service.extendSession(15)}
                    />
                  ) : null}
                  <Button
                    label={t('remote.phone.sessionStop')}
                    size="sm"
                    variant="danger"
                    onPress={() => service.stopSession()}
                    testID="remote-host-stop"
                  />
                </View>
              </View>
            </Card>
          ) : null}

          <Text
            style={[
              typography.overline,
              {
                color: colors.textSecondary,
                marginTop: spacing.sm,
                paddingHorizontal: spacing.xs,
              },
            ]}
          >
            {t('remote.phone.trusted')}
          </Text>
          <Card>
            {host.peers.trusted.length === 0 ? (
              <ListRow title={t('remote.phone.trustedEmpty')} />
            ) : (
              host.peers.trusted.map((peer, index) => (
                <ListRow
                  key={peer.id}
                  title={peer.name}
                  subtitle={displayDeviceId(peer.id)}
                  icon="shieldCheck"
                  divider={index > 0}
                  onPress={() => peerActions(peer.id, peer.name, false)}
                />
              ))
            )}
          </Card>
          {host.peers.blocked.length ? (
            <>
              <Text
                style={[
                  typography.overline,
                  {
                    color: colors.textSecondary,
                    marginTop: spacing.sm,
                    paddingHorizontal: spacing.xs,
                  },
                ]}
              >
                {t('remote.phone.blocked')}
              </Text>
              <Card>
                {host.peers.blocked.map((peer, index) => (
                  <ListRow
                    key={peer.id}
                    title={peer.name}
                    subtitle={displayDeviceId(peer.id)}
                    icon="lock"
                    destructive
                    divider={index > 0}
                    onPress={() => peerActions(peer.id, peer.name, true)}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
      <Card>
        <ListRow
          title={t('remote.phone.settingsLink')}
          icon="settings"
          chevron
          onPress={onOpenSettings}
        />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  idCard: { alignItems: 'center' },
  id: { letterSpacing: 2 },
  center: { textAlign: 'center' },
  mono: { textAlign: 'center', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
});
