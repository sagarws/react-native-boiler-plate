import React, { useState } from 'react';
import { Alert, Image, Linking, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Notice, StatusPill } from '@/shared/components';
import type { DriveCredentialStatus } from '@/features/capture';
import { useTheme } from '@/theme';
import type { UseGoogleAccount } from '../hooks/useGoogleAccount';
import { ROOT_FOLDER_NAME } from '../repository/drive.repository';
import type { ConnectFailure } from '../types';
import { CardHeader } from './CardHeader';

export interface DriveAccountCardProps {
  google: UseGoogleAccount;
  /** The shared Drive from Settings → File Management (used when not connected). */
  shared: DriveCredentialStatus;
  /** Id of the start folder in this Drive, once known (for "Open in Google Drive"). */
  rootFolderId?: string;
  /** Opens Settings → File Management. */
  onManageShared: () => void;
}

/**
 * Google Drive card: connect / disconnect the user's own Drive; when not
 * connected, says whether the shared Drive (Settings) is in use.
 */
export function DriveAccountCard({
  google,
  shared,
  rootFolderId,
  onManageShared,
}: DriveAccountCardProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [failure, setFailure] = useState<ConnectFailure | null>(null);
  const { account } = google;

  const connect = async () => {
    setFailure(null);
    const outcome = await google.connect();
    if (!outcome.ok && outcome.reason !== 'cancelled')
      setFailure(outcome.reason);
  };

  const disconnect = () =>
    Alert.alert(t('files.disconnectTitle'), t('files.disconnectBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('files.disconnect'),
        style: 'destructive',
        onPress: () => {
          void google.disconnect();
        },
      },
    ]);

  const caption = [typography.caption, { color: colors.textSecondary }];
  const body = [typography.body, { color: colors.textPrimary }];

  return (
    <Card flat testID="files-drive-card">
      <CardHeader
        icon="cloud"
        title={t('files.driveTitle')}
        subtitle={t('files.driveSubtitle')}
        right={
          google.ready ? (
            <StatusPill
              testID="files-drive-status"
              label={
                account
                  ? t('files.connected')
                  : shared.configured
                  ? t('files.sharedDrive')
                  : t('files.notConnected')
              }
              tone={
                account ? 'success' : shared.configured ? 'primary' : 'neutral'
              }
            />
          ) : null
        }
      />
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        {failure ? (
          <Notice
            testID="files-connect-error"
            tone="error"
            message={t(`files.connectFail_${failure}`)}
            onDismiss={() => setFailure(null)}
          />
        ) : null}

        {account ? (
          <>
            <View style={[styles.row, { gap: spacing.md }]}>
              {account.photo ? (
                <Image
                  source={{ uri: account.photo }}
                  style={styles.avatar}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <View
                  style={[
                    styles.avatar,
                    styles.initial,
                    { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Text
                    style={[typography.title, { color: colors.primaryText }]}
                  >
                    {(account.name || account.email).slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.flex}>
                <Text
                  style={[typography.label, { color: colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {account.name}
                </Text>
                <Text
                  style={caption}
                  numberOfLines={1}
                  testID="files-account-email"
                >
                  {account.email}
                </Text>
              </View>
            </View>
            <Text style={caption}>
              {t('files.savedIn', { folder: ROOT_FOLDER_NAME })}
            </Text>
            <View style={[styles.row, { gap: spacing.sm }]}>
              {rootFolderId ? (
                <Button
                  size="sm"
                  variant="soft"
                  iconName="externalLink"
                  label={t('files.openInDrive')}
                  onPress={() => {
                    void Linking.openURL(
                      `https://drive.google.com/drive/folders/${rootFolderId}`,
                    );
                  }}
                  style={styles.flex}
                  testID="files-open-drive"
                />
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                label={t('files.disconnect')}
                onPress={disconnect}
                disabled={google.busy}
                style={styles.flex}
                testID="files-disconnect"
              />
            </View>
          </>
        ) : (
          <>
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('files.connectTitle')}
            </Text>
            <Text style={body}>
              {t('files.connectBody', { folder: ROOT_FOLDER_NAME })}
            </Text>
            {(['point1', 'point2', 'point3'] as const).map(key => (
              <Text key={key} style={caption}>
                {`•  ${t(`files.${key}`)}`}
              </Text>
            ))}
            <Notice
              testID="files-shared-state"
              tone="info"
              message={
                shared.configured
                  ? t('files.usingShared')
                  : t('files.sharedHint')
              }
            />
            {shared.configured && rootFolderId ? (
              <Button
                size="sm"
                variant="soft"
                iconName="externalLink"
                label={t('files.openInDrive')}
                onPress={() => {
                  void Linking.openURL(
                    `https://drive.google.com/drive/folders/${rootFolderId}`,
                  );
                }}
                testID="files-open-shared"
              />
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              iconName="settings"
              label={t('files.manageShared')}
              onPress={onManageShared}
              testID="files-manage-shared"
            />
            <Button
              iconName="cloud"
              label={google.busy ? t('files.connecting') : t('files.connect')}
              loading={google.busy}
              disabled={!google.ready || google.busy}
              onPress={() => {
                void connect();
              }}
              testID="files-connect"
            />
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  initial: { alignItems: 'center', justifyContent: 'center' },
});
