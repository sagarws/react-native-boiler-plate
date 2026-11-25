import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  ChoiceList,
  Notice,
  SegmentedControl,
  TextField,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { REMOTE_SERVER, SESSION_MINUTES } from '../core/constants';
import { normaliseIceUrl, normaliseRelay, passwordProblem } from '../core/ids';
import {
  remoteActions,
  updateRemoteSettings,
  useRemoteSettings,
  useRemoteState,
} from '../hooks/useRemote';
import { modelName } from '../services/identity';
import { remoteNative } from '../services/native.service';
import { QUALITY_PRESETS } from '../store/remoteSettings.store';
import type { QualityPreset, SessionMinutes } from '../types';
import { minutesLabel } from '../utils/labels';
import { SettingSwitchRow } from './SettingSwitchRow';

function Title({ children }: { children: string }) {
  const { colors, typography, spacing } = useTheme();
  return (
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
      {children}
    </Text>
  );
}

/** Settings → Remote Access: controlling others, this phone, unattended password, network. */
export function RemoteSettingsSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const settings = useRemoteSettings();
  const { host, savedPasswordIds } = useRemoteState();
  const onForgetAllPasswords = () =>
    Alert.alert(
      t('remote.settings.forgetAllPasswords'),
      t('remote.settings.forgetAllPasswordsConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('remote.connect.forgetPassword'),
          style: 'destructive',
          onPress: remoteActions.forgetAllSavedPasswords,
        },
      ],
    );
  const [name, setName] = useState(settings.deviceName);
  const [relay, setRelay] = useState(settings.relay);
  const [turnUrl, setTurnUrl] = useState(settings.turnUrl);
  const [turnUser, setTurnUser] = useState(settings.turnUsername);
  const [turnCred, setTurnCred] = useState(settings.turnCredential);
  const [networkSaved, setNetworkSaved] = useState(false);
  const [pw, setPw] = useState({
    open: false,
    a: '',
    b: '',
    error: null as string | null,
    progress: null as number | null,
  });

  useEffect(() => {
    remoteActions.start();
  }, []);

  const relayInvalid = relay.trim() !== '' && !normaliseRelay(relay);
  const turnInvalid = turnUrl.trim() !== '' && !normaliseIceUrl(turnUrl);

  const saveNetwork = () => {
    if (relayInvalid || turnInvalid) return;
    updateRemoteSettings({
      relay,
      turnUrl,
      turnUsername: turnUser,
      turnCredential: turnCred,
    });
    setNetworkSaved(true);
    setTimeout(() => setNetworkSaved(false), 2000);
  };

  const savePassword = async () => {
    const problem = passwordProblem(pw.a);
    if (problem)
      return setPw(p => ({
        ...p,
        error: t(`remote.settings.passwordProblem.${problem}`),
      }));
    if (pw.a !== pw.b)
      return setPw(p => ({
        ...p,
        error: t('remote.settings.passwordMismatch'),
      }));
    setPw(p => ({ ...p, error: null, progress: 0 }));
    await remoteActions
      .host()
      .setPassword(pw.a, progress => setPw(p => ({ ...p, progress })));
    setPw({ open: false, a: '', b: '', error: null, progress: null });
  };

  const removePassword = () =>
    Alert.alert(t('remote.settings.removePassword'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('remote.settings.removePassword'),
        style: 'destructive',
        onPress: () => {
          remoteActions
            .host()
            .setPassword(null)
            .catch(() => undefined);
        },
      },
    ]);

  return (
    <>
      <Title>{t('remote.settings.controller')}</Title>
      <Card>
        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typography.label, { color: colors.textPrimary }]}>
            {t('remote.settings.defaultQuality')}
          </Text>
          <ChoiceList<QualityPreset>
            value={settings.defaultQuality}
            onChange={defaultQuality =>
              updateRemoteSettings({ defaultQuality })
            }
            accessibilityLabel={t('remote.settings.defaultQuality')}
            testID="remote-settings-quality"
            choices={QUALITY_PRESETS.map(q => ({
              value: q,
              title: t(`remote.quality.${q}`),
              description: t(
                `remote.quality.${q}Hint` as 'remote.quality.autoHint',
              ),
            }))}
          />
          <Text
            style={[
              typography.label,
              { color: colors.textPrimary, marginTop: spacing.sm },
            ]}
          >
            {t('remote.settings.priority')}
          </Text>
          <SegmentedControl
            value={settings.priority}
            onChange={priority => updateRemoteSettings({ priority })}
            accessibilityLabel={t('remote.settings.priority')}
            options={[
              {
                value: 'readability',
                label: t('remote.settings.priorityReadability'),
              },
              {
                value: 'responsiveness',
                label: t('remote.settings.priorityResponsiveness'),
              },
            ]}
          />
          <Text
            style={[
              typography.label,
              { color: colors.textPrimary, marginTop: spacing.sm },
            ]}
          >
            {t('remote.settings.touchMode')}
          </Text>
          <SegmentedControl
            value={settings.touchMode}
            onChange={touchMode => updateRemoteSettings({ touchMode })}
            accessibilityLabel={t('remote.settings.touchMode')}
            options={[
              { value: 'direct', label: t('remote.viewer.touchDirect') },
              { value: 'trackpad', label: t('remote.viewer.touchTrackpad') },
            ]}
          />
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('remote.viewer.touchModeHint')}
          </Text>
        </View>
        <SettingSwitchRow
          label={t('remote.settings.viewOnly')}
          hint={t('remote.settings.viewOnlyHint')}
          value={settings.viewOnly}
          onChange={viewOnly => updateRemoteSettings({ viewOnly })}
        />
        <SettingSwitchRow
          label={t('remote.settings.keepAwake')}
          value={settings.keepAwake}
          onChange={keepAwake => updateRemoteSettings({ keepAwake })}
        />
        {remoteNative.canSealSecrets ? (
          <>
            <SettingSwitchRow
              label={t('remote.settings.rememberPasswords')}
              hint={t('remote.settings.rememberPasswordsHint')}
              value={settings.rememberPasswords}
              onChange={rememberPasswords =>
                updateRemoteSettings({ rememberPasswords })
              }
              testID="remote-settings-remember-passwords"
            />
            {savedPasswordIds.length ? (
              <View style={{ padding: spacing.lg, paddingTop: 0 }}>
                <Button
                  label={`${t('remote.settings.forgetAllPasswords')} (${t(
                    'remote.settings.savedPasswordsCount',
                    { count: savedPasswordIds.length },
                  )})`}
                  variant="secondary"
                  size="sm"
                  onPress={onForgetAllPasswords}
                  testID="remote-settings-forget-passwords"
                />
              </View>
            ) : null}
          </>
        ) : null}
      </Card>

      <Title>{t('remote.settings.host')}</Title>
      {remoteNative.canHost ? (
        <Card>
          <SettingSwitchRow
            label={t('remote.phone.allow')}
            hint={t('remote.phone.allowHint')}
            value={settings.allowIncoming}
            onChange={allowIncoming => updateRemoteSettings({ allowIncoming })}
            testID="remote-settings-allow"
          />
          <View style={{ padding: spacing.lg, gap: spacing.sm }}>
            <TextField
              label={t('remote.settings.deviceName')}
              placeholder={t('remote.settings.deviceNamePlaceholder', {
                model: modelName(),
              })}
              value={name}
              onChangeText={setName}
              onEndEditing={() => updateRemoteSettings({ deviceName: name })}
              maxLength={64}
            />
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('remote.settings.defaultMinutes')}
            </Text>
            <SegmentedControl<string>
              value={String(settings.defaultMinutes)}
              onChange={v =>
                updateRemoteSettings({
                  defaultMinutes: Number(v) as SessionMinutes,
                })
              }
              accessibilityLabel={t('remote.settings.defaultMinutes')}
              options={SESSION_MINUTES.filter(m =>
                [15, 30, 60, 0].includes(m),
              ).map(m => ({ value: String(m), label: minutesLabel(t, m) }))}
            />
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('remote.settings.defaultMinutesHint')}
            </Text>
          </View>
          <SettingSwitchRow
            label={t('remote.settings.unattended')}
            hint={t('remote.settings.unattendedHint')}
            value={settings.unattendedEnabled && host.unattendedSet}
            disabled={!host.unattendedSet}
            onChange={unattendedEnabled =>
              updateRemoteSettings({ unattendedEnabled })
            }
          />
          <View style={{ padding: spacing.lg, gap: spacing.sm }}>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {host.unattendedSet
                ? t('remote.settings.passwordSet')
                : t('remote.settings.passwordNone')}
            </Text>
            {host.unattendedSet ? (
              <>
                <Text style={[typography.label, { color: colors.textPrimary }]}>
                  {t('remote.settings.unattendedPermission')}
                </Text>
                <SegmentedControl
                  value={settings.unattendedPermission}
                  onChange={unattendedPermission =>
                    updateRemoteSettings({ unattendedPermission })
                  }
                  accessibilityLabel={t('remote.settings.unattendedPermission')}
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
            {pw.open ? (
              <>
                <TextField
                  label={t('remote.settings.newPassword')}
                  value={pw.a}
                  onChangeText={a => setPw(p => ({ ...p, a, error: null }))}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextField
                  label={t('remote.settings.confirmPassword')}
                  value={pw.b}
                  onChangeText={b => setPw(p => ({ ...p, b, error: null }))}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  error={pw.error}
                />
                {pw.progress !== null ? (
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {t('remote.settings.savingPassword', {
                      percent: Math.round(pw.progress * 100),
                    })}
                  </Text>
                ) : null}
                <View style={[styles.row, { gap: spacing.sm }]}>
                  <Button
                    label={t('common.cancel')}
                    variant="secondary"
                    size="sm"
                    onPress={() =>
                      setPw({
                        open: false,
                        a: '',
                        b: '',
                        error: null,
                        progress: null,
                      })
                    }
                  />
                  <Button
                    label={t('remote.settings.save')}
                    size="sm"
                    loading={pw.progress !== null}
                    onPress={() => {
                      savePassword().catch(() => undefined);
                    }}
                  />
                </View>
              </>
            ) : (
              <View style={[styles.row, { gap: spacing.sm }]}>
                <Button
                  label={
                    host.unattendedSet
                      ? t('remote.settings.changePassword')
                      : t('remote.settings.setPassword')
                  }
                  size="sm"
                  variant="soft"
                  onPress={() => setPw(p => ({ ...p, open: true }))}
                />
                {host.unattendedSet ? (
                  <Button
                    label={t('remote.settings.removePassword')}
                    size="sm"
                    variant="ghost"
                    onPress={removePassword}
                  />
                ) : null}
              </View>
            )}
          </View>
        </Card>
      ) : (
        <Notice tone="info" message={t('remote.phone.iosUnsupported')} />
      )}

      <Title>{t('remote.settings.network')}</Title>
      <Card>
        <SettingSwitchRow
          label={t('remote.settings.lanDiscovery')}
          value={settings.lanDiscovery}
          onChange={lanDiscovery => updateRemoteSettings({ lanDiscovery })}
        />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <TextField
            label={t('remote.settings.relay')}
            placeholder={REMOTE_SERVER.relay}
            value={relay}
            onChangeText={setRelay}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            error={relayInvalid ? t('remote.settings.relayInvalid') : null}
          />
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('remote.settings.relayHint', {
              server: REMOTE_SERVER.relay.replace(/^wss:\/\//, ''),
            })}
          </Text>
          <TextField
            label={t('remote.settings.turnUrl')}
            value={turnUrl}
            onChangeText={setTurnUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            error={turnInvalid ? t('remote.settings.turnInvalid') : null}
          />
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('remote.settings.turnHint')}
          </Text>
          {turnUrl.trim() ? (
            <>
              <TextField
                label={t('remote.settings.turnUsername')}
                value={turnUser}
                onChangeText={setTurnUser}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextField
                label={t('remote.settings.turnCredential')}
                value={turnCred}
                onChangeText={setTurnCred}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          ) : null}
          <Button
            label={
              networkSaved
                ? t('remote.settings.saved')
                : t('remote.settings.save')
            }
            size="sm"
            disabled={relayInvalid || turnInvalid}
            onPress={saveNetwork}
          />
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
