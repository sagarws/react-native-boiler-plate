import React, { useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { screenOcrService } from '@/features/capture';
import { formatDay } from '@/features/life';
import type { IconName } from '@/shared/assets';
import {
  Button,
  Card,
  EmptyState,
  Header,
  Icon,
  Notice,
} from '@/shared/components';
import { logger } from '@/shared/utils';
import { toDayKey } from '@/shared/utils/dayKey';
import { useTheme } from '@/theme';
import { useUtilityData } from '../hooks/useUtility';
import { ensureCamera, openAppSettings } from '../services/camera';
import { utilityNative, UtilityError } from '../services/native.service';
import { parseCode, type ParsedCode } from '../services/qr';
import { utilityStore } from '../store/utility.store';
import type { ScanRecord } from '../types';

const KIND_ICON: Record<ParsedCode['kind'], IconName> = {
  url: 'link',
  phone: 'phone',
  email: 'mail',
  sms: 'messageCircle',
  wifi: 'smartphone',
  geo: 'mapPin',
  product: 'qrCode',
  text: 'type',
};

type Problem = 'denied' | 'blocked' | 'camera_failed' | 'unavailable' | null;

/**
 * QR & barcode scanner. The camera opens only after "Start scanning"; a
 * result is shown with actions that fit it — links are opened only after a
 * confirmation showing the full address, and nothing is ever run or
 * installed from a code.
 */
export default function ScannerScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const { scans } = useUtilityData();
  const [current, setCurrent] = useState<ScanRecord | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    if (busy) return;
    setProblem(null);
    setToast(null);
    const access = await ensureCamera();
    if (access !== 'granted') {
      setProblem(
        access === 'blocked'
          ? 'blocked'
          : access === 'denied'
          ? 'denied'
          : 'unavailable',
      );
      return;
    }
    setBusy(true);
    try {
      const result = await utilityNative.scanBarcode({
        close: t('common.close'),
        aim: t('utility.scanAim'),
        pause: t('utility.scanPause'),
        resume: t('utility.scanResume'),
        paused: t('utility.scanPaused'),
        torchOn: t('utility.torchOn'),
        torchOff: t('utility.torchOff'),
      });
      if (result) {
        const kind = parseCode(result.value, result.format).kind;
        setCurrent(
          utilityStore.addScan({
            value: result.value,
            format: result.format,
            kind,
          }),
        );
      }
    } catch (error) {
      const code = error instanceof UtilityError ? error.code : 'camera_failed';
      setProblem(
        code === 'camera_permission'
          ? 'denied'
          : code === 'unavailable'
          ? 'unavailable'
          : 'camera_failed',
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    const ok = await screenOcrService.copy(text);
    setToast(ok ? t('utility.copied') : t('utility.copyFailed'));
  };

  const open = (url: string) =>
    Linking.openURL(url).catch(error => {
      logger.warn(
        'scanned link could not be opened',
        (error as Error)?.message,
      );
      setToast(t('utility.cannotOpen'));
    });

  const confirmLink = (parsed: Extract<ParsedCode, { kind: 'url' }>) =>
    Alert.alert(
      t('utility.openLinkTitle'),
      [
        parsed.warning ? t(`utility.linkWarn_${parsed.warning}`) : null,
        parsed.url,
      ]
        .filter(Boolean)
        .join('\n\n'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('utility.openLink'),
          onPress: () => {
            void open(parsed.url);
          },
        },
      ],
    );

  const actions = (record: ScanRecord) => {
    const parsed = parseCode(record.value, record.format);
    const list: {
      label: string;
      icon: IconName;
      onPress: () => void;
      id: string;
    }[] = [
      {
        label: t('utility.copy'),
        icon: 'copy',
        onPress: () => {
          void copy(record.value);
        },
        id: 'copy',
      },
    ];
    if (parsed.kind === 'url')
      list.push({
        label: t('utility.openLink'),
        icon: 'externalLink',
        onPress: () => confirmLink(parsed),
        id: 'open',
      });
    if (parsed.kind === 'phone' || parsed.kind === 'sms')
      list.push({
        label: t('utility.callNumber'),
        icon: 'phone',
        onPress: () => {
          void open(`tel:${parsed.phone}`);
        },
        id: 'call',
      });
    if (parsed.kind === 'email')
      list.push({
        label: t('utility.sendEmail'),
        icon: 'mail',
        onPress: () => {
          void open(
            `mailto:${encodeURIComponent(
              parsed.email,
            )}?subject=${encodeURIComponent(
              parsed.subject,
            )}&body=${encodeURIComponent(parsed.body)}`,
          );
        },
        id: 'email',
      });
    if (parsed.kind === 'wifi' && parsed.password)
      list.push({
        label: t('utility.copyPassword'),
        icon: 'lock',
        onPress: () => {
          void copy(parsed.password);
        },
        id: 'wifi',
      });
    return { parsed, list };
  };

  const detail = (parsed: ParsedCode): string | null => {
    switch (parsed.kind) {
      case 'url':
        return parsed.host;
      case 'wifi':
        return t('utility.wifiDetail', {
          ssid: parsed.ssid,
          security: parsed.security,
        });
      case 'email':
        return parsed.email;
      case 'geo':
        return `${parsed.lat}, ${parsed.lng}`;
      default:
        return null;
    }
  };

  const result = current ? actions(current) : null;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_scanner')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {toast ? (
          <Notice
            tone="success"
            message={toast}
            onDismiss={() => setToast(null)}
          />
        ) : null}
        {problem ? (
          <Notice
            tone="error"
            title={t(`utility.cameraProblemTitle_${problem}`)}
            message={t(`utility.cameraProblem_${problem}`)}
            action={
              problem === 'blocked'
                ? { label: t('utility.openSettings'), onPress: openAppSettings }
                : {
                    label: t('utility.tryAgain'),
                    onPress: () => {
                      void scan();
                    },
                  }
            }
            testID="scanner-problem"
          />
        ) : null}

        {result && current ? (
          <Card testID="scan-result">
            <View style={{ gap: spacing.sm }}>
              <View style={[styles.row, { gap: spacing.sm }]}>
                <Icon
                  name={KIND_ICON[result.parsed.kind]}
                  size={20}
                  color={colors.primaryText}
                />
                <Text
                  style={[
                    typography.label,
                    styles.flex,
                    { color: colors.textPrimary },
                  ]}
                >
                  {t(`utility.kind_${result.parsed.kind}`)} ·{' '}
                  {current.format.replace(/_/g, '-')}
                </Text>
              </View>
              <Text
                selectable
                style={[typography.body, { color: colors.textPrimary }]}
              >
                {current.value}
              </Text>
              {detail(result.parsed) ? (
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {detail(result.parsed)}
                </Text>
              ) : null}
              {result.parsed.kind === 'url' && result.parsed.warning ? (
                <Text style={[typography.caption, { color: colors.warning }]}>
                  {t(`utility.linkWarn_${result.parsed.warning}`)}
                </Text>
              ) : null}
              <View style={[styles.wrap, { gap: spacing.sm }]}>
                {result.list.map(a => (
                  <Button
                    key={a.id}
                    size="sm"
                    variant="soft"
                    iconName={a.icon}
                    label={a.label}
                    onPress={a.onPress}
                    testID={`scan-action-${a.id}`}
                  />
                ))}
              </View>
            </View>
          </Card>
        ) : (
          <Card>
            <View style={{ gap: spacing.sm }}>
              <Text style={[typography.body, { color: colors.textPrimary }]}>
                {t('utility.scannerIntro')}
              </Text>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t('utility.scannerPermission')}
              </Text>
            </View>
          </Card>
        )}

        <Button
          label={current ? t('utility.scanAgain') : t('utility.startScanning')}
          iconName="scanLine"
          onPress={() => {
            void scan();
          }}
          loading={busy}
          testID="scanner-start"
        />

        <View style={[styles.row, { marginTop: spacing.md }]}>
          <Text
            style={[
              typography.title,
              styles.flex,
              { color: colors.textPrimary },
            ]}
          >
            {t('utility.history')}
          </Text>
          {scans.length ? (
            <Button
              size="sm"
              variant="ghost"
              label={t('utility.clearHistory')}
              onPress={() =>
                Alert.alert(
                  t('utility.clearHistoryTitle'),
                  t('utility.clearHistoryBody'),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('utility.clearHistory'),
                      style: 'destructive',
                      onPress: () => {
                        utilityStore.clearScans();
                        setCurrent(null);
                      },
                    },
                  ],
                )
              }
              testID="scanner-clear"
            />
          ) : null}
        </View>
        {scans.length ? (
          scans.map(s => (
            <Pressable
              key={s.id}
              onPress={() => setCurrent(s)}
              accessibilityRole="button"
              accessibilityLabel={`${t(`utility.kind_${s.kind}`)}: ${s.value}`}
              style={[
                styles.row,
                {
                  gap: spacing.sm,
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceMuted,
                },
              ]}
              testID={`scan-${s.id}`}
            >
              <Icon
                name={KIND_ICON[s.kind]}
                size={18}
                color={colors.textSecondary}
              />
              <View style={styles.flex}>
                <Text
                  style={[typography.body, { color: colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {s.value}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {s.format.replace(/_/g, '-')} ·{' '}
                  {formatDay(toDayKey(new Date(s.at)))}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  utilityStore.deleteScan(s.id);
                  if (current?.id === s.id) setCurrent(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('utility.deleteScan')}
                hitSlop={8}
                testID={`scan-${s.id}-delete`}
              >
                <Icon name="trash2" size={18} color={colors.error} />
              </Pressable>
            </Pressable>
          ))
        ) : (
          <EmptyState compact icon="history" title={t('utility.noScans')} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
});
