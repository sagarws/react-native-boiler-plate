import React, { useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  Loader,
  Notice,
} from '@/shared/components';
import { useTheme } from '@/theme';
import type { UseFileBrowser } from '../hooks/useFileBrowser';
import type { DriveItem, DriveSource } from '../types';
import { CardHeader } from './CardHeader';
import { FileRow } from './FileRow';

export interface FileShareCardProps {
  /** Null when neither an account nor the shared Drive is set up. */
  source: DriveSource | null;
  browser: UseFileBrowser;
}

/**
 * File Share card: breadcrumb folders, upload (with an optional
 * description), new folder, and the folder's items with share/open/edit/
 * delete. Everything lives in the connected Google Drive.
 */
export function FileShareCard({ source, browser }: FileShareCardProps) {
  const connected = source !== null;
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [description, setDescription] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');

  const items = [...browser.folders, ...browser.files];

  const upload = async () => {
    if (await browser.pickAndUpload(description)) setDescription('');
  };

  const createFolder = async () => {
    if (await browser.createFolder(folderName)) {
      setFolderName('');
      setAddingFolder(false);
    }
  };

  const share = async (item: DriveItem) => {
    const link = await browser.share(item);
    if (link) {
      void Share.share({
        message: t('files.shareMessage', { name: item.name, link }),
      });
    }
  };

  const remove = (item: DriveItem) =>
    Alert.alert(
      t('files.deleteTitle', { name: item.name }),
      t('files.deleteBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('files.delete'),
          style: 'destructive',
          onPress: () => {
            void browser.trash(item);
          },
        },
      ],
    );

  const open = (item: DriveItem) => {
    if (item.webViewLink) void Linking.openURL(item.webViewLink);
  };

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
  const caption = [typography.caption, { color: colors.textSecondary }];
  const ready = connected && browser.path.length > 0;
  // The friendly message plus Google's own reason, so the cause is visible.
  const errorText = browser.error
    ? [
        t(`files.error_${browser.error}`),
        browser.errorDetail
          ? t('files.googleSays', { detail: browser.errorDetail })
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  return (
    <Card flat testID="files-share-card">
      <CardHeader
        icon="share2"
        title={t('files.shareTitle')}
        subtitle={t('files.shareSubtitle')}
        right={
          ready ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('files.refresh')}
              onPress={browser.refresh}
              style={styles.iconButton}
              testID="files-refresh"
            >
              <Icon name="refreshCw" size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null
        }
      />

      {!connected ? (
        <View style={{ padding: spacing.lg }}>
          <Notice
            testID="files-needs-drive"
            tone="info"
            message={t('files.needsDrive')}
          />
        </View>
      ) : (
        <View>
          {/* Breadcrumb */}
          {browser.path.length > 0 ? (
            <View
              accessibilityLabel={t('files.breadcrumb')}
              style={[
                styles.crumbs,
                {
                  paddingHorizontal: spacing.lg,
                  paddingTop: spacing.md,
                },
              ]}
            >
              {browser.path.map((folder, index) => {
                const last = index === browser.path.length - 1;
                return (
                  <View key={folder.id} style={styles.crumbItem}>
                    {index > 0 ? (
                      <Icon
                        name="chevronRight"
                        size={14}
                        color={colors.textSecondary}
                      />
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      disabled={last}
                      onPress={() => browser.goTo(index)}
                      testID={`files-crumb-${index}`}
                      hitSlop={8}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          typography.label,
                          styles.crumbText,
                          {
                            color: last
                              ? colors.textPrimary
                              : colors.primaryText,
                          },
                        ]}
                      >
                        {index === 0 && source?.kind === 'shared'
                          ? t('files.sharedDrive')
                          : folder.name}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Upload / new folder */}
          <View style={{ padding: spacing.lg, gap: spacing.sm }}>
            <TextInput
              testID="files-description"
              accessibilityLabel={t('files.descriptionPlaceholder')}
              placeholder={t('files.descriptionPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={description}
              onChangeText={setDescription}
              maxLength={500}
              editable={ready && !browser.upload}
              style={inputStyle}
            />
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Button
                iconName="upload"
                label={t('files.upload')}
                onPress={() => {
                  void upload();
                }}
                disabled={!ready || Boolean(browser.upload)}
                style={styles.flex}
                testID="files-upload"
              />
              <Button
                variant="soft"
                iconName="folderPlus"
                label={t('files.newFolder')}
                onPress={() => setAddingFolder(v => !v)}
                disabled={!ready}
                style={styles.flex}
                testID="files-new-folder"
              />
            </View>
            {addingFolder ? (
              <View style={[styles.row, { gap: spacing.sm }]}>
                <TextInput
                  testID="files-folder-name"
                  accessibilityLabel={t('files.newFolderPlaceholder')}
                  placeholder={t('files.newFolderPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  value={folderName}
                  onChangeText={setFolderName}
                  maxLength={100}
                  autoFocus
                  onSubmitEditing={() => {
                    void createFolder();
                  }}
                  style={[inputStyle, styles.flex]}
                />
                <Button
                  size="sm"
                  label={t('files.create')}
                  disabled={!folderName.trim()}
                  onPress={() => {
                    void createFolder();
                  }}
                  testID="files-create-folder"
                />
              </View>
            ) : null}

            {browser.upload ? (
              <View style={{ gap: spacing.xs }} testID="files-upload-progress">
                <Text style={caption} numberOfLines={1}>
                  {t('files.uploading', {
                    name: browser.upload.name,
                    percent: Math.round(browser.upload.progress * 100),
                  })}
                </Text>
                <View
                  style={[
                    styles.track,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderRadius: radius.sm,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${Math.round(browser.upload.progress * 100)}%`,
                        backgroundColor: colors.primary,
                        borderRadius: radius.sm,
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}

            {browser.error && browser.status !== 'error' ? (
              <Notice testID="files-error" tone="error" message={errorText} />
            ) : null}
          </View>

          {/* Items */}
          <View
            style={{
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.divider,
            }}
          >
            {browser.status === 'loading' ? (
              <View
                style={[
                  styles.loading,
                  { padding: spacing.xl, gap: spacing.sm },
                ]}
              >
                <Loader />
                <Text style={caption}>{t('files.loading')}</Text>
              </View>
            ) : browser.status === 'error' && items.length === 0 ? (
              <View style={{ padding: spacing.lg, gap: spacing.md }}>
                <Notice
                  testID="files-load-error"
                  tone="error"
                  message={errorText}
                />
                {browser.error === 'permission' &&
                source?.kind === 'account' ? (
                  <Button
                    iconName="lock"
                    label={t('files.grantAccess')}
                    onPress={() => {
                      void browser.grantAccess();
                    }}
                    testID="files-grant-access"
                  />
                ) : null}
                <Button
                  variant="soft"
                  iconName="refreshCw"
                  label={t('files.retry')}
                  onPress={browser.refresh}
                  testID="files-retry"
                />
              </View>
            ) : items.length === 0 ? (
              <EmptyState
                compact
                icon="folder"
                title={t('files.emptyTitle')}
                message={t('files.emptyBody')}
                testID="files-empty"
              />
            ) : (
              <>
                <Text
                  style={[
                    caption,
                    { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
                  ]}
                >
                  {t('files.itemsSummary', {
                    folders: browser.folders.length,
                    files: browser.files.length,
                  })}
                </Text>
                {items.map((item, index) => (
                  <FileRow
                    key={item.id}
                    item={item}
                    busy={browser.busyId === item.id}
                    divider={index > 0}
                    onOpenFolder={browser.openFolder}
                    onOpen={open}
                    onShare={row => {
                      void share(row);
                    }}
                    onDelete={remove}
                    onSaveDescription={browser.setDescription}
                  />
                ))}
              </>
            )}
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  crumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  crumbItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  crumbText: { maxWidth: 160 },
  loading: { alignItems: 'center' },
  input: { borderWidth: 1, minHeight: 48 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { height: 6, overflow: 'hidden' },
  fill: { height: 6 },
});
