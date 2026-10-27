import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAudioShare, useCaptureSettings } from '@/features/capture';
import {
  Button,
  ExpandableCard,
  ListRow,
  Notice,
  StatusPill,
  type StatusTone,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { SettingSwitch } from './SettingControls';

export interface AudioShareSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

const RETRY_DELAY_MS = 300;

/**
 * Share voice to Chrome: the switch, the address to enter in the extension,
 * the approval prompt (every new computer must be allowed), and the live
 * connection state.
 */
export function AudioShareSection({
  expanded,
  onToggle,
}: AudioShareSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const { settings, updateAudioShare } = useCaptureSettings();
  const enabled = settings.audioShare.enabled;
  const share = useAudioShare(enabled);
  const { status } = share;
  const name = status.receiverName || 'Chrome';

  const summary = !enabled
    ? t('audioShare.summaryOff')
    : status.state === 'streaming'
    ? t('audioShare.summaryStreaming', { name })
    : status.state === 'connected'
    ? t('audioShare.summaryConnected', { name })
    : status.state === 'pending'
    ? t('audioShare.summaryPending')
    : t('audioShare.summaryWaiting');

  const tone: StatusTone =
    status.state === 'streaming'
      ? 'success'
      : status.state === 'connected'
      ? 'primary'
      : status.state === 'pending'
      ? 'warning'
      : 'neutral';

  // Restart the server: off, then on again once the native side has seen it.
  const retry = useCallback(() => {
    updateAudioShare({ enabled: false });
    setTimeout(() => updateAudioShare({ enabled: true }), RETRY_DELAY_MS);
  }, [updateAudioShare]);

  const caption = [typography.caption, { color: colors.textSecondary }];
  const label = [typography.label, { color: colors.textPrimary }];
  const block = [
    styles.block,
    { padding: spacing.lg, gap: spacing.sm, borderTopColor: colors.divider },
  ];
  const showPairing =
    enabled &&
    status.address.length > 0 &&
    (status.state === 'waiting' || status.state === 'pending') &&
    !status.error;

  return (
    <ExpandableCard
      title={t('audioShare.section')}
      summary={summary}
      icon="audioLines"
      expanded={expanded}
      onToggle={onToggle}
      footer={t('audioShare.privacy')}
      testID="settings-audio-share"
    >
      <ListRow
        icon="audioLines"
        title={t('audioShare.apply')}
        subtitle={t('audioShare.applyHint')}
        right={
          <SettingSwitch
            testID="audio-share-enabled"
            value={enabled}
            onChange={on => updateAudioShare({ enabled: on })}
            label={t('audioShare.apply')}
          />
        }
      />

      {enabled ? (
        <View style={block}>
          <View style={styles.row}>
            <Text style={[label, styles.flex]}>{t('audioShare.section')}</Text>
            <StatusPill
              testID="audio-share-state"
              label={t(`audioShare.state_${status.state}`)}
              tone={tone}
            />
          </View>

          {status.error ? (
            <Notice
              testID="audio-share-error"
              tone="error"
              message={t(`audioShare.error_${status.error}`)}
            />
          ) : null}
          {status.error && status.error !== 'unsupported' ? (
            <Button
              size="sm"
              variant="soft"
              iconName="rotateCcw"
              label={t('audioShare.retry')}
              onPress={retry}
              testID="audio-share-retry"
            />
          ) : null}

          {showPairing ? (
            <View
              style={[
                styles.pairing,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  gap: spacing.xs,
                },
              ]}
            >
              <Text style={caption}>{t('audioShare.address')}</Text>
              <Text
                selectable
                testID="audio-share-address"
                accessibilityLabel={`${t('audioShare.address')}: ${
                  status.address
                }:${status.port}`}
                style={[
                  typography.title,
                  styles.mono,
                  { color: colors.textPrimary },
                ]}
              >
                {status.address}:{status.port}
              </Text>
            </View>
          ) : null}
          {showPairing ? (
            <Text style={caption}>{t('audioShare.addressHint')}</Text>
          ) : null}

          {status.state === 'pending' ? (
            <View style={{ gap: spacing.sm }}>
              <Notice
                testID="audio-share-request"
                tone="warning"
                message={`${t('audioShare.requestTitle', { name })}\n${t(
                  'audioShare.requestBody',
                  { fingerprint: status.fingerprint },
                )}`}
              />
              <View style={[styles.row, { gap: spacing.sm }]}>
                <Button
                  size="sm"
                  variant="secondary"
                  label={t('audioShare.deny')}
                  onPress={share.deny}
                  style={styles.flex}
                  testID="audio-share-deny"
                />
                <Button
                  size="sm"
                  label={t('audioShare.allow')}
                  iconName="check"
                  onPress={share.approve}
                  style={styles.flex}
                  testID="audio-share-allow"
                />
              </View>
            </View>
          ) : null}

          {status.state === 'connected' || status.state === 'streaming' ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={label}>{t('audioShare.receiver', { name })}</Text>
              <Text testID="audio-share-activity" style={caption}>
                {status.state === 'connected'
                  ? t('audioShare.paused')
                  : status.transmitting
                  ? t('audioShare.transmitting')
                  : t('audioShare.idle')}
              </Text>
              <Button
                size="sm"
                variant="secondary"
                iconName="x"
                label={t('audioShare.disconnect')}
                onPress={share.disconnect}
                testID="audio-share-disconnect"
              />
            </View>
          ) : null}

          {status.state === 'waiting' ? (
            <Text style={caption}>{t('audioShare.howTo')}</Text>
          ) : null}
        </View>
      ) : null}
    </ExpandableCard>
  );
}

const styles = StyleSheet.create({
  block: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  pairing: {},
  mono: { fontVariant: ['tabular-nums'], letterSpacing: 1 },
});
