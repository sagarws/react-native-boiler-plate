import React, { useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, SegmentedControl } from '@/shared/components';
import { useTheme } from '@/theme';
import { liveCameraActions, useQrCode } from '../hooks/useLiveCamera';
import {
  FRAME_RATES,
  MAX_VIEWERS_LIMIT,
  normaliseServerUrl,
  RESOLUTIONS,
  TITLE_MAX,
} from '../store/liveCameraSettings.store';
import type {
  LiveCameraSettings,
  LiveCameraState,
  PublishStats,
  RemoteStream,
} from '../types';

export const formatDuration = (sec: number): string => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const SectionTitle = ({ children }: { children: string }) => {
  const { colors, typography, spacing } = useTheme();
  return (
    <Text
      style={[
        typography.label,
        { color: colors.textPrimary, marginBottom: spacing.sm },
      ]}
    >
      {children}
    </Text>
  );
};

// ── live information ──

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text
        style={[typography.label, { color: color ?? colors.textPrimary }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

export function LiveInfoCard({
  state,
  elapsed,
}: {
  state: LiveCameraState;
  elapsed: number | null;
}) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const s: PublishStats | null = state.stats;
  const stream = state.stream;
  const qualityColor =
    s?.quality === 'good'
      ? colors.success
      : s?.quality === 'fair'
      ? colors.warning
      : s?.quality === 'poor'
      ? colors.error
      : colors.textSecondary;
  return (
    <Card testID="live-info">
      <SectionTitle>{t('liveCamera.info.title')}</SectionTitle>
      <View style={[styles.grid, { gap: spacing.md }]}>
        <Stat
          label={t('liveCamera.info.status')}
          value={t(`liveCamera.phase.${state.phase}`)}
        />
        <Stat
          label={t('liveCamera.info.viewers')}
          value={stream ? `${stream.viewers} / ${stream.maxViewers}` : '–'}
        />
        <Stat
          label={t('liveCamera.info.duration')}
          value={elapsed === null ? '–' : formatDuration(elapsed)}
        />
        <Stat
          label={t('liveCamera.info.resolution')}
          value={s?.width ? `${s.width}×${s.height}` : '–'}
        />
        <Stat
          label={t('liveCamera.info.fps')}
          value={s ? String(s.fps) : '–'}
        />
        <Stat
          label={t('liveCamera.info.upload')}
          value={
            s
              ? s.kbps >= 1000
                ? `${(s.kbps / 1000).toFixed(1)} Mbps`
                : `${s.kbps} kbps`
              : '–'
          }
        />
        <Stat
          label={t('liveCamera.info.quality')}
          value={`● ${t(`liveCamera.quality.${s?.quality ?? 'unknown'}`)}`}
          color={qualityColor}
        />
        <Stat label={t('liveCamera.info.streamId')} value={stream?.id ?? '–'} />
      </View>
    </Card>
  );
}

// ── share ──

export function ShareCard({
  stream,
  busy,
}: {
  stream: RemoteStream;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = stream.viewerUrl;
  const qr = useQrCode(qrOpen ? url : null);

  const copy = async () => {
    if (!url) return;
    const ok = await liveCameraActions.copy(url);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card testID="live-share">
      <SectionTitle>{t('liveCamera.share.title')}</SectionTitle>
      <View
        style={[
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
            padding: spacing.md,
          },
        ]}
      >
        <Text
          selectable
          testID="live-url"
          style={[
            typography.body,
            { color: url ? colors.textPrimary : colors.textSecondary },
          ]}
        >
          {url ?? t('liveCamera.share.revoked')}
        </Text>
      </View>
      {url ? (
        <View style={[styles.row, { gap: spacing.sm, marginTop: spacing.md }]}>
          <Button
            label={
              copied ? t('liveCamera.share.copied') : t('liveCamera.share.copy')
            }
            iconName="copy"
            size="sm"
            variant="soft"
            onPress={copy}
            style={styles.flex}
          />
          <Button
            label={t('liveCamera.share.share')}
            iconName="link"
            size="sm"
            variant="soft"
            onPress={() =>
              Share.share({
                message: t('liveCamera.share.message', { url }),
              })
            }
            style={styles.flex}
          />
        </View>
      ) : null}
      {url ? (
        <View style={[styles.row, { gap: spacing.sm, marginTop: spacing.sm }]}>
          <Button
            label={t('liveCamera.share.qr')}
            iconName="qrCode"
            size="sm"
            variant="soft"
            onPress={() => setQrOpen(true)}
            style={styles.flex}
          />
          <Button
            label={t('liveCamera.share.open')}
            iconName="externalLink"
            size="sm"
            variant="soft"
            onPress={() => Linking.openURL(url)}
            style={styles.flex}
          />
        </View>
      ) : null}
      <View style={[styles.row, { gap: spacing.sm, marginTop: spacing.sm }]}>
        <Button
          label={t('liveCamera.share.regenerate')}
          iconName="refreshCw"
          size="sm"
          variant="secondary"
          disabled={busy}
          onPress={liveCameraActions.regenerateLink}
          style={styles.flex}
        />
        {url ? (
          <Button
            label={t('liveCamera.share.revoke')}
            iconName="x"
            size="sm"
            variant="secondary"
            disabled={busy}
            onPress={liveCameraActions.revokeLink}
            style={styles.flex}
          />
        ) : null}
      </View>

      <Modal
        visible={qrOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQrOpen(false)}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setQrOpen(false)}
        >
          <View
            style={[
              styles.qrBox,
              { backgroundColor: '#fff', borderRadius: radius.lg },
            ]}
            testID="live-qr"
          >
            {qr ? (
              <Image source={{ uri: qr }} style={styles.qr} />
            ) : (
              <View style={styles.qr} />
            )}
            <Text style={[typography.caption, styles.qrText]}>
              {t('liveCamera.share.qrHint')}
            </Text>
          </View>
        </Pressable>
      </Modal>
    </Card>
  );
}

// ── settings ──

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text
        style={[
          typography.caption,
          { color: colors.textSecondary, marginBottom: spacing.xs },
        ]}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

export function SettingsCard({
  settings,
  live,
}: {
  settings: LiveCameraSettings;
  /** While streaming, camera settings are locked (stop to change them). */
  live: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [title, setTitle] = useState(settings.title);
  const [password, setPassword] = useState(liveCameraActions.password);
  const [server, setServer] = useState(settings.serverUrl);
  const [serverCheck, setServerCheck] = useState<'ok' | 'bad' | 'busy' | null>(
    null,
  );

  const input = [
    typography.body,
    styles.input,
    {
      color: colors.textPrimary,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
    },
  ];

  const saveServer = async () => {
    const url = normaliseServerUrl(server);
    if (!url) return setServerCheck('bad');
    setServer(url);
    setServerCheck('busy');
    await liveCameraActions.updateSettings({ serverUrl: url });
    setServerCheck((await liveCameraActions.testServer(url)) ? 'ok' : 'bad');
  };

  return (
    <Card testID="live-settings">
      <SectionTitle>{t('liveCamera.settings.title')}</SectionTitle>
      {live ? (
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('liveCamera.settings.lockedWhileLive')}
        </Text>
      ) : null}

      <Row label={t('liveCamera.settings.resolution')}>
        <SegmentedControl
          options={RESOLUTIONS.map(r => ({ value: r, label: r }))}
          value={settings.resolution}
          onChange={r =>
            !live && liveCameraActions.updateSettings({ resolution: r })
          }
          accessibilityLabel={t('liveCamera.settings.resolution')}
          testID="live-resolution"
        />
      </Row>
      <Row label={t('liveCamera.settings.fps')}>
        <SegmentedControl
          options={FRAME_RATES.map(f => ({
            value: String(f) as '15' | '24' | '30',
            label: `${f} FPS`,
          }))}
          value={String(settings.fps) as '15' | '24' | '30'}
          onChange={f =>
            !live &&
            liveCameraActions.updateSettings({
              fps: Number(f) as 15 | 24 | 30,
            })
          }
          accessibilityLabel={t('liveCamera.settings.fps')}
        />
      </Row>
      <View style={[styles.switchRow, { marginTop: spacing.md }]}>
        <Text
          style={[typography.body, styles.flex, { color: colors.textPrimary }]}
        >
          {t('liveCamera.settings.audio')}
        </Text>
        <Switch
          value={settings.audio}
          disabled={live}
          onValueChange={audio => {
            liveCameraActions.updateSettings({ audio });
          }}
          accessibilityLabel={t('liveCamera.settings.audio')}
          trackColor={{ false: colors.disabled, true: colors.primary }}
          thumbColor={colors.surface}
          testID="live-audio"
        />
      </View>

      <Row label={t('liveCamera.settings.streamTitle')}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          onEndEditing={() => liveCameraActions.updateSettings({ title })}
          maxLength={TITLE_MAX}
          placeholder={t('liveCamera.settings.streamTitlePlaceholder')}
          placeholderTextColor={colors.placeholder}
          style={input}
          testID="live-title"
        />
      </Row>

      <Row label={t('liveCamera.settings.access')}>
        <SegmentedControl
          options={[
            { value: 'public', label: t('liveCamera.settings.public') },
            { value: 'private', label: t('liveCamera.settings.private') },
          ]}
          value={settings.access}
          onChange={access => liveCameraActions.updateSettings({ access })}
          accessibilityLabel={t('liveCamera.settings.access')}
          testID="live-access"
        />
      </Row>
      {settings.access === 'private' ? (
        <Row label={t('liveCamera.settings.password')}>
          <TextInput
            value={password}
            onChangeText={p => {
              setPassword(p);
              liveCameraActions.setPassword(p);
            }}
            onEndEditing={() => {
              if (live && password.length >= 4)
                liveCameraActions.pushPassword();
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={128}
            placeholder={t('liveCamera.settings.passwordPlaceholder')}
            placeholderTextColor={colors.placeholder}
            style={input}
            testID="live-password"
          />
        </Row>
      ) : null}

      <Row label={t('liveCamera.settings.maxViewers')}>
        <View style={[styles.row, styles.center, { gap: spacing.md }]}>
          <Button
            label="−"
            size="sm"
            variant="soft"
            onPress={() =>
              liveCameraActions.updateSettings({
                maxViewers: Math.max(1, settings.maxViewers - 1),
              })
            }
            accessibilityLabel={t('liveCamera.settings.fewerViewers')}
          />
          <Text
            style={[typography.h2, styles.count, { color: colors.textPrimary }]}
            testID="live-max-viewers"
          >
            {settings.maxViewers}
          </Text>
          <Button
            label="+"
            size="sm"
            variant="soft"
            onPress={() =>
              liveCameraActions.updateSettings({
                maxViewers: Math.min(
                  MAX_VIEWERS_LIMIT,
                  settings.maxViewers + 1,
                ),
              })
            }
            accessibilityLabel={t('liveCamera.settings.moreViewers')}
          />
        </View>
      </Row>

      <Row label={t('liveCamera.settings.server')}>
        <TextInput
          value={server}
          onChangeText={v => {
            setServer(v);
            setServerCheck(null);
          }}
          editable={!live}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://203-0-113-25.sslip.io"
          placeholderTextColor={colors.placeholder}
          style={input}
          testID="live-server"
        />
        <View
          style={[
            styles.row,
            styles.center,
            { gap: spacing.sm, marginTop: spacing.sm },
          ]}
        >
          <Button
            label={t('liveCamera.settings.saveServer')}
            size="sm"
            variant="soft"
            disabled={live || serverCheck === 'busy'}
            onPress={saveServer}
            testID="live-server-save"
          />
          {serverCheck && serverCheck !== 'busy' ? (
            <Text
              style={[
                typography.caption,
                { color: serverCheck === 'ok' ? colors.success : colors.error },
              ]}
            >
              {t(`liveCamera.settings.server_${serverCheck}`)}
            </Text>
          ) : null}
        </View>
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  center: { alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { width: '45%' },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  input: { borderWidth: 1, minHeight: 46 },
  count: { minWidth: 40, textAlign: 'center' },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  qrBox: { padding: 20, alignItems: 'center' },
  qr: { width: 260, height: 260 },
  qrText: { color: '#333', marginTop: 10 },
});
