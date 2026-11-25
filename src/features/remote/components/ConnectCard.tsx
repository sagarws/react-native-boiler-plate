import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, ListRow, Notice, TextField } from '@/shared/components';
import { useTheme } from '@/theme';
import { displayDeviceId, parseDeviceId } from '../core/ids';
import {
  remoteActions,
  updateRemoteSettings,
  useRemoteSettings,
} from '../hooks/useRemote';
import type { ConnectState } from '../services/remote.service';
import { remoteNative } from '../services/native.service';
import { connectErrorText } from '../utils/labels';
import { SettingSwitchRow } from './SettingSwitchRow';

export interface ConnectCardProps {
  connect: ConnectState;
  /** Device IDs with a saved password. */
  savedPasswordIds: string[];
  /** Prefill from a tapped device. */
  prefill: { target: string; password: boolean; nonce: number } | null;
}

/** ID / address entry, the optional password, and the attempt's progress. */
export function ConnectCard({
  connect,
  savedPasswordIds,
  prefill,
}: ConnectCardProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const settings = useRemoteSettings();
  const [target, setTarget] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!prefill) return;
    setTarget(displayDeviceId(prefill.target));
    setUsePassword(prefill.password);
  }, [prefill]);

  const targetId = parseDeviceId(target);
  const hasSaved = !!targetId && savedPasswordIds.includes(targetId);
  const typed = usePassword && password ? password : undefined;

  const busy =
    connect.stage === 'connecting' ||
    connect.stage === 'password' ||
    connect.stage === 'waiting';
  const onConnect = () => {
    if (!target.trim()) return;
    // No password typed: the saved one, if this device has one.
    void remoteActions.connect(target, typed, { useSaved: !typed });
  };

  return (
    <Card testID="remote-connect-card">
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.title, { color: colors.textPrimary }]}>
            {t('remote.connect.title')}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('remote.connect.hint')}
          </Text>
        </View>
        <TextField
          label={t('remote.connect.targetLabel')}
          placeholder={t('remote.connect.targetPlaceholder')}
          value={target}
          onChangeText={next => {
            setTarget(next);
            remoteActions.clearConnectError();
          }}
          keyboardType="default"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={onConnect}
          editable={!busy}
          testID="remote-target"
        />
        {usePassword ? (
          <TextField
            label={t('remote.connect.passwordLabel')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            passwordToggle
            passwordVisible={showPassword}
            onTogglePassword={() => setShowPassword(v => !v)}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            testID="remote-password"
          />
        ) : null}
        {hasSaved && !typed ? (
          <View
            style={[
              styles.row,
              {
                gap: spacing.sm,
                backgroundColor: colors.primarySoft,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
              },
            ]}
            testID="remote-saved-password"
          >
            <Text
              style={[
                typography.label,
                styles.flex,
                { color: colors.primaryText },
              ]}
            >
              {t('remote.connect.savedPassword')}
            </Text>
            <Button
              label={t('remote.connect.forgetPassword')}
              variant="ghost"
              size="sm"
              disabled={busy}
              onPress={() =>
                targetId && remoteActions.forgetSavedPassword(targetId)
              }
              testID="remote-forget-password"
            />
          </View>
        ) : null}
      </View>
      <SettingSwitchRow
        label={t('remote.connect.usePassword')}
        value={usePassword}
        onChange={setUsePassword}
        testID="remote-use-password"
      />
      {usePassword && remoteNative.canSealSecrets ? (
        <SettingSwitchRow
          label={t('remote.connect.rememberPassword')}
          value={settings.rememberPasswords}
          onChange={rememberPasswords =>
            updateRemoteSettings({ rememberPasswords })
          }
          testID="remote-remember-password"
        />
      ) : null}
      <SettingSwitchRow
        label={t('remote.connect.viewOnly')}
        value={settings.viewOnly}
        onChange={viewOnly => updateRemoteSettings({ viewOnly })}
        testID="remote-view-only"
      />
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        {busy ? (
          <View
            style={[
              styles.progress,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: radius.lg,
                padding: spacing.lg,
                gap: spacing.sm,
              },
            ]}
            accessibilityLiveRegion="polite"
          >
            <View style={[styles.row, { gap: spacing.sm }]}>
              <ActivityIndicator color={colors.primary} />
              <Text
                style={[
                  typography.label,
                  styles.flex,
                  { color: colors.textPrimary },
                ]}
              >
                {connect.stage === 'waiting'
                  ? t('remote.connect.waitingTitle', {
                      name: connect.hostName ?? connect.target,
                    })
                  : connect.progress !== null
                  ? t('remote.connect.checkingPassword', {
                      percent: Math.round(connect.progress * 100),
                    })
                  : t('remote.connect.connecting', {
                      target: connect.hostName ?? connect.target,
                    })}
              </Text>
            </View>
            {connect.stage === 'waiting' && connect.verificationCode ? (
              <>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('remote.connect.waitingHint')}
                </Text>
                <Text
                  style={[
                    typography.h1,
                    styles.code,
                    { color: colors.primary },
                  ]}
                  testID="remote-verification-code"
                >
                  {connect.verificationCode}
                </Text>
              </>
            ) : null}
            <Button
              label={t('remote.connect.cancel')}
              variant="secondary"
              size="sm"
              onPress={remoteActions.cancelConnect}
            />
          </View>
        ) : (
          <Button
            label={t('remote.connect.button')}
            iconName="monitor"
            onPress={onConnect}
            disabled={!target.trim()}
            testID="remote-connect"
          />
        )}
        {connect.stage === 'error' ? (
          <Notice
            tone="error"
            message={
              connect.savedPasswordRemoved
                ? `${connectErrorText(t, connect)} ${t(
                    'remote.connect.savedPasswordRemoved',
                  )}`
                : connectErrorText(t, connect)
            }
            onDismiss={remoteActions.clearConnectError}
            testID="remote-connect-error"
          />
        ) : null}
      </View>
    </Card>
  );
}

export function ActiveSessionRow({
  name,
  onOpen,
}: {
  name: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <ListRow
        title={t('remote.connect.activeSession', { name })}
        icon="monitor"
        chevron
        onPress={onOpen}
        accessibilityHint={t('remote.connect.openViewer')}
        testID="remote-open-viewer"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  progress: { alignItems: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  code: { textAlign: 'center', letterSpacing: 4 },
});
