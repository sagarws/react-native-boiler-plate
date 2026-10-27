import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  DRIVE_NOT_CONFIGURED,
  driveCredentialsService,
  type DriveCredentialStatus,
} from '@/features/capture';
import { driveRepository, type DriveErrorCode } from '@/features/files';
import {
  Button,
  ExpandableCard,
  Notice,
  StatusPill,
} from '@/shared/components';
import { useTheme } from '@/theme';

export interface DriveCredentialsSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

type Message = { tone: 'success' | 'error'; text: string } | null;

/**
 * Settings → File Management → Shared Google Drive: the OAuth client,
 * refresh token and folder File Share uses when no personal account is
 * connected. Write-only for the secrets: saved values show as "…abcd" and a
 * blank field keeps what is stored.
 */
export function DriveCredentialsSection({
  expanded,
  onToggle,
}: DriveCredentialsSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [status, setStatus] =
    useState<DriveCredentialStatus>(DRIVE_NOT_CONFIGURED);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [folderId, setFolderId] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(async () => {
    const next = await driveCredentialsService.getStatus();
    setStatus(next);
    setClientId(next.clientId);
    setFolderId(next.folderId);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy('save');
    setMessage(null);
    const ok = await driveCredentialsService.save({
      clientId,
      clientSecret,
      refreshToken,
      folderId,
    });
    // Secrets leave JS state as soon as they've been handed to native storage.
    setClientSecret('');
    setRefreshToken('');
    if (ok) await load();
    setBusy(null);
    setMessage(
      ok
        ? { tone: 'success', text: t('driveCreds.saved') }
        : { tone: 'error', text: t('driveCreds.saveFailed') },
    );
  };

  const test = async () => {
    setBusy('test');
    setMessage(null);
    try {
      const count = await driveRepository.checkShared(status.folderId);
      setMessage({ tone: 'success', text: t('driveCreds.testOk', { count }) });
    } catch (error) {
      const code = ((error as { code?: DriveErrorCode }).code ??
        'unknown') as DriveErrorCode;
      setMessage({ tone: 'error', text: t(`files.error_${code}`) });
    } finally {
      setBusy(null);
    }
  };

  const restoreDefaults = () => {
    driveCredentialsService.restoreDefaults();
    setClientSecret('');
    setRefreshToken('');
    void load();
    setMessage({ tone: 'success', text: t('driveCreds.restored') });
  };

  const remove = () =>
    Alert.alert(t('driveCreds.removeTitle'), t('driveCreds.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('driveCreds.remove'),
        style: 'destructive',
        onPress: () => {
          driveCredentialsService.clear();
          setClientSecret('');
          setRefreshToken('');
          void load();
          setMessage({ tone: 'success', text: t('driveCreds.removed') });
        },
      },
    ]);

  const inputStyle = [
    typography.body,
    styles.input,
    {
      color: colors.textPrimary,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
    },
  ];
  const label = [typography.label, { color: colors.textPrimary }];
  const caption = [typography.caption, { color: colors.textSecondary }];

  const field = (
    title: string,
    value: string,
    onChange: (v: string) => void,
    testID: string,
    options: { secret?: boolean; hint?: string; placeholder?: string } = {},
  ) => (
    <View style={{ gap: spacing.xs }}>
      <Text style={label}>{title}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={title}
        value={value}
        onChangeText={onChange}
        placeholder={options.placeholder}
        placeholderTextColor={colors.placeholder}
        secureTextEntry={options.secret}
        autoCapitalize="none"
        autoCorrect={false}
        importantForAutofill="no"
        style={inputStyle}
      />
      {options.hint ? <Text style={caption}>{options.hint}</Text> : null}
    </View>
  );

  const secretHint = (hint: string) =>
    status.configured && hint
      ? t('driveCreds.secretSaved', { hint })
      : t('driveCreds.secretNew');

  return (
    <ExpandableCard
      title={t('driveCreds.section')}
      summary={
        status.configured
          ? t('driveCreds.summaryOn', { folder: status.folderId })
          : t('driveCreds.summaryOff')
      }
      icon="cloud"
      expanded={expanded}
      onToggle={onToggle}
      footer={t('driveCreds.security')}
      testID="settings-drive-creds"
    >
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Text style={[caption, styles.flex]}>{t('driveCreds.intro')}</Text>
          <StatusPill
            testID="drive-creds-status"
            label={
              status.configured
                ? t('files.connected')
                : t('driveCreds.summaryOff')
            }
            tone={status.configured ? 'success' : 'neutral'}
          />
        </View>

        {field(
          t('driveCreds.clientId'),
          clientId,
          setClientId,
          'drive-creds-client-id',
          {
            placeholder: t('driveCreds.clientIdPlaceholder'),
          },
        )}
        {field(
          t('driveCreds.clientSecret'),
          clientSecret,
          setClientSecret,
          'drive-creds-secret',
          {
            secret: true,
            hint: secretHint(status.secretHint),
          },
        )}
        {field(
          t('driveCreds.refreshToken'),
          refreshToken,
          setRefreshToken,
          'drive-creds-token',
          {
            secret: true,
            hint: secretHint(status.tokenHint),
          },
        )}
        {field(
          t('driveCreds.folderId'),
          folderId,
          setFolderId,
          'drive-creds-folder',
          {
            placeholder: t('driveCreds.folderIdPlaceholder'),
          },
        )}

        {status.source === 'default' ? (
          <Notice
            testID="drive-creds-default"
            tone="info"
            message={t('driveCreds.usingDefault')}
          />
        ) : null}

        {status.hasDefaults && status.source !== 'default' ? (
          <Button
            size="sm"
            variant="soft"
            iconName="rotateCcw"
            label={t('driveCreds.restoreDefault')}
            onPress={restoreDefaults}
            testID="drive-creds-restore"
          />
        ) : null}

        {message ? (
          <Notice
            testID="drive-creds-message"
            tone={message.tone}
            message={message.text}
          />
        ) : null}

        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            label={t('driveCreds.save')}
            iconName="lock"
            loading={busy === 'save'}
            disabled={busy !== null || !clientId.trim() || !folderId.trim()}
            onPress={() => {
              void save();
            }}
            style={styles.flex}
            testID="drive-creds-save"
          />
          <Button
            variant="soft"
            iconName="circleCheck"
            label={
              busy === 'test' ? t('driveCreds.testing') : t('driveCreds.test')
            }
            loading={busy === 'test'}
            disabled={busy !== null || !status.configured}
            onPress={() => {
              void test();
            }}
            style={styles.flex}
            testID="drive-creds-test"
          />
        </View>
        {status.configured ? (
          <Button
            size="sm"
            variant="ghost"
            iconName="trash2"
            label={t('driveCreds.remove')}
            onPress={remove}
            testID="drive-creds-remove"
          />
        ) : null}
      </View>
    </ExpandableCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  input: { borderWidth: 1, minHeight: 48 },
});
