import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  Header,
  Icon,
  ListRow,
  Notice,
  SegmentedControl,
  StatusPill,
  TextField,
  ToggleSwitch,
  type StatusTone,
} from '@/shared/components';
import { logger } from '@/shared/utils';
import { useTheme } from '@/theme';
import { useUtilityData } from '../hooks/useUtility';
import { useScanKeyboard } from '../hooks/useScanKeyboard';
import { ensureCamera, openAppSettings } from '../services/camera';
import { parseCode } from '../services/qr';
import {
  scanKeyboard,
  suffixText,
  type GunScan,
  type KbState,
} from '../services/scanKeyboard.service';
import { utilityStore } from '../store/utility.store';
import type { GunSuffix } from '../types';

const TONE: Record<KbState, StatusTone> = {
  unsupported: 'error',
  permission: 'warning',
  bluetooth_off: 'warning',
  stopped: 'neutral',
  starting: 'neutral',
  ready: 'warning',
  connecting: 'primary',
  connected: 'success',
};

type Problem = 'camera_denied' | 'camera_blocked' | 'camera_failed' | null;

/**
 * Scanner gun: the phone works as a Bluetooth keyboard for a paired
 * computer and types every scanned QR code / barcode where the cursor is,
 * with a beep — like a handheld scanner, with nothing installed on the PC.
 */
export default function ScanGunScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();
  const { prefs } = useUtilityData();
  const { status, hosts, loaded, allow } = useScanKeyboard();
  const [session, setSession] = useState<GunScan[] | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  const [testText, setTestText] = useState('');
  const [note, setNote] = useState<{
    tone: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [pairing, setPairing] = useState(false);

  const connected = status.state === 'connected';
  const usable =
    status.state === 'ready' ||
    status.state === 'connecting' ||
    status.state === 'connected';

  const startScanning = async () => {
    if (busy) return;
    setProblem(null);
    setNote(null);
    const access = await ensureCamera();
    if (access !== 'granted') {
      setProblem(access === 'blocked' ? 'camera_blocked' : 'camera_denied');
      return;
    }
    setBusy(true);
    try {
      const scans = await scanKeyboard.startGun({
        suffix: prefs.gunSuffix,
        beep: prefs.gunBeep,
        vibrate: prefs.gunVibrate,
        labels: {
          close: t('common.close'),
          aim: t('utility.gunAim'),
          pause: t('utility.scanPause'),
          resume: t('utility.scanResume'),
          paused: t('utility.scanPaused'),
          torchOn: t('utility.torchOn'),
          torchOff: t('utility.torchOff'),
          typed: t('utility.gunNativeTyped'),
          skipped: t('utility.gunNativeSkipped'),
          notTyped: t('utility.gunNotTyped'),
          count: t('utility.gunNativeCount'),
          noComputer: t('utility.gunNoComputer'),
        },
      });
      // Oldest first, so the newest ends up on top of the history.
      scans.forEach(s =>
        utilityStore.addScan({
          value: s.value,
          format: s.format,
          kind: parseCode(s.value, s.format).kind,
        }),
      );
      setSession(scans);
    } catch (error) {
      logger.warn('scanner gun failed', (error as Error)?.message);
      setProblem('camera_failed');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    const text = testText.trim();
    if (!text) return;
    const skipped = await scanKeyboard.type(text + suffixText(prefs.gunSuffix));
    if (skipped === null)
      setNote({ tone: 'error', text: t('utility.gunNotTyped') });
    else if (skipped > 0)
      setNote({
        tone: 'warning',
        text: t('utility.gunSkipped', { count: skipped }),
      });
    else setNote({ tone: 'success', text: t('utility.gunTestSent') });
  };

  const pairNew = () => {
    setPairing(true);
    scanKeyboard.makeDiscoverable();
  };

  const stateText =
    status.state === 'connected' && status.host
      ? t('utility.gunState_connected', { name: status.host.name })
      : t(`utility.gunState_${status.state}`);

  const typedCount = session?.filter(s => s.typed).length ?? 0;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_scanGun')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <View style={{ gap: spacing.sm }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Icon name="monitor" size={20} color={colors.primaryText} />
              <Text
                style={[
                  typography.label,
                  styles.flex,
                  { color: colors.textPrimary },
                ]}
              >
                {t('utility.gunComputer')}
              </Text>
              {loaded ? (
                <StatusPill
                  label={t(`utility.gunPill_${status.state}`)}
                  tone={TONE[status.state]}
                  testID="gun-state"
                />
              ) : null}
            </View>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {stateText}
            </Text>
            {status.state === 'permission' ? (
              <Button
                label={t('utility.gunAllow')}
                iconName="shieldCheck"
                onPress={() => {
                  void allow().then(ok => {
                    if (!ok)
                      setNote({
                        tone: 'error',
                        text: t('utility.gunPermissionDenied'),
                      });
                  });
                }}
                testID="gun-allow"
              />
            ) : null}
            {status.state === 'bluetooth_off' ? (
              <Button
                label={t('utility.gunTurnOn')}
                iconName="settings"
                onPress={scanKeyboard.openBluetoothSettings}
                testID="gun-bt-settings"
              />
            ) : null}
            {connected ? (
              <Button
                size="sm"
                variant="ghost"
                label={t('utility.gunDisconnect')}
                onPress={scanKeyboard.disconnect}
                testID="gun-disconnect"
              />
            ) : null}
          </View>
        </Card>

        {usable && !connected ? (
          <Card testID="gun-hosts">
            <View style={{ gap: spacing.sm }}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('utility.gunPaired')}
              </Text>
              {hosts.length ? (
                hosts.map((h, i) => (
                  <ListRow
                    key={h.address}
                    title={h.name}
                    subtitle={
                      h.last
                        ? t('utility.gunLastUsed')
                        : h.computer
                        ? t('utility.gunIsComputer')
                        : undefined
                    }
                    icon={h.computer ? 'monitor' : 'smartphone'}
                    divider={i < hosts.length - 1}
                    onPress={() => {
                      void scanKeyboard.connect(h.address).then(ok => {
                        if (!ok)
                          setNote({
                            tone: 'error',
                            text: t('utility.gunConnectFailed'),
                          });
                      });
                    }}
                    right={
                      status.connecting === h.address ? (
                        <Text
                          style={[
                            typography.caption,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {t('utility.gunPill_connecting')}
                        </Text>
                      ) : undefined
                    }
                    accessibilityHint={t('utility.gunConnectHint')}
                    testID={`gun-host-${i}`}
                  />
                ))
              ) : (
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('utility.gunNoPaired')}
                </Text>
              )}
              <Button
                variant="soft"
                iconName="plus"
                label={t('utility.gunPairNew')}
                onPress={pairNew}
                testID="gun-pair"
              />
              {pairing ? (
                <Notice
                  tone="info"
                  title={t('utility.gunPairTitle')}
                  message={t('utility.gunPairSteps', {
                    name: status.phoneName || t('utility.gunThisPhone'),
                  })}
                  onDismiss={() => setPairing(false)}
                  testID="gun-pair-steps"
                />
              ) : null}
            </View>
          </Card>
        ) : null}

        {status.state === 'unsupported' && loaded ? (
          <Notice tone="error" message={t('utility.gunUnsupported')} />
        ) : null}

        {note ? (
          <Notice
            tone={note.tone}
            message={note.text}
            onDismiss={() => setNote(null)}
          />
        ) : null}
        {problem ? (
          <Notice
            tone="error"
            message={t(`utility.gunProblem_${problem}`)}
            action={
              problem === 'camera_blocked'
                ? { label: t('utility.openSettings'), onPress: openAppSettings }
                : undefined
            }
            testID="gun-problem"
          />
        ) : null}

        <Button
          size="lg"
          label={t('utility.gunStart')}
          iconName="scanLine"
          onPress={() => {
            void startScanning();
          }}
          disabled={!connected}
          loading={busy}
          accessibilityHint={t('utility.gunStartHint')}
          testID="gun-start"
        />
        {!connected && usable ? (
          <Text
            style={[
              typography.caption,
              styles.center,
              { color: colors.textSecondary },
            ]}
          >
            {t('utility.gunConnectFirst')}
          </Text>
        ) : null}

        {session ? (
          <Card testID="gun-session">
            <View style={{ gap: spacing.xs }}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('utility.gunSession', {
                  count: session.length,
                  typed: typedCount,
                })}
              </Text>
              {session
                .slice(-20)
                .reverse()
                .map((s, i) => (
                  <View
                    key={`${i}-${s.value}`}
                    style={[styles.row, { gap: spacing.sm }]}
                  >
                    <Icon
                      name={s.typed ? 'check' : 'x'}
                      size={16}
                      color={s.typed ? colors.success : colors.error}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        typography.body,
                        styles.flex,
                        { color: colors.textPrimary },
                      ]}
                    >
                      {s.value}
                    </Text>
                  </View>
                ))}
            </View>
          </Card>
        ) : null}

        <Card>
          <View style={{ gap: spacing.md }}>
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('utility.gunAfterCode')}
            </Text>
            <SegmentedControl<GunSuffix>
              options={[
                { value: 'enter', label: t('utility.gunSuffix_enter') },
                { value: 'tab', label: t('utility.gunSuffix_tab') },
                { value: 'none', label: t('utility.gunSuffix_none') },
              ]}
              value={prefs.gunSuffix}
              onChange={v => utilityStore.updatePrefs({ gunSuffix: v })}
              accessibilityLabel={t('utility.gunAfterCode')}
              testID="gun-suffix"
            />
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Text
                style={[
                  typography.body,
                  styles.flex,
                  { color: colors.textPrimary },
                ]}
              >
                {t('utility.gunBeep')}
              </Text>
              <ToggleSwitch
                isOn={prefs.gunBeep}
                onToggle={v => utilityStore.updatePrefs({ gunBeep: v })}
                accessibilityLabel={t('utility.gunBeep')}
              />
            </View>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Text
                style={[
                  typography.body,
                  styles.flex,
                  { color: colors.textPrimary },
                ]}
              >
                {t('utility.gunVibrate')}
              </Text>
              <ToggleSwitch
                isOn={prefs.gunVibrate}
                onToggle={v => utilityStore.updatePrefs({ gunVibrate: v })}
                accessibilityLabel={t('utility.gunVibrate')}
              />
            </View>
          </View>
        </Card>

        {connected ? (
          <Card>
            <View style={{ gap: spacing.sm }}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('utility.gunTest')}
              </Text>
              <TextField
                label={t('utility.gunTest')}
                placeholder={t('utility.gunTestPlaceholder')}
                value={testText}
                onChangeText={setTestText}
                autoCapitalize="none"
                autoCorrect={false}
                testID="gun-test-input"
              />
              <Button
                variant="soft"
                size="sm"
                iconName="type"
                label={t('utility.gunTestSend')}
                onPress={() => {
                  void sendTest();
                }}
                disabled={!testText.trim()}
                testID="gun-test-send"
              />
            </View>
          </Card>
        ) : null}

        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('utility.gunFootnote')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
});
