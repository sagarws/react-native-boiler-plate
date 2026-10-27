import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { IconName } from '@/shared/assets';
import { Button, Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import type { DriveItem } from '../types';
import {
  fileKind,
  formatSize,
  formatWhen,
  type FileKind,
  sizedThumbnail,
} from '../utils/format';

const KIND_ICONS: Record<FileKind, IconName> = {
  image: 'palette',
  video: 'play',
  audio: 'audioLines',
  pdf: 'bookOpen',
  archive: 'layers',
  text: 'type',
  doc: 'scrollText',
  other: 'scanText',
};

export interface FileRowProps {
  item: DriveItem;
  busy: boolean;
  divider: boolean;
  onOpenFolder: (item: DriveItem) => void;
  /** Tapping a file opens its preview. */
  onPreview: (item: DriveItem) => void;
  onOpen: (item: DriveItem) => void;
  onShare: (item: DriveItem) => void;
  onDelete: (item: DriveItem) => void;
  onSaveDescription: (item: DriveItem, description: string) => Promise<boolean>;
}

/** One folder or file in File Share, with its actions. */
export function FileRow({
  item,
  busy,
  divider,
  onOpenFolder,
  onPreview,
  onOpen,
  onShare,
  onDelete,
  onSaveDescription,
}: FileRowProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.description);
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbnail = !item.isFolder && item.thumbnailLink && !thumbFailed;

  const meta = [formatSize(item.size), formatWhen(item.modifiedAt)]
    .filter(Boolean)
    .join(' · ');
  const icon: IconName = item.isFolder
    ? 'folder'
    : KIND_ICONS[fileKind(item.mimeType, item.name)];
  const caption = [typography.caption, { color: colors.textSecondary }];

  const action = (
    name: IconName,
    label: string,
    onPress: () => void,
    testID: string,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={busy}
      testID={testID}
      style={({ pressed }) => [
        styles.action,
        { borderRadius: radius.md },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Icon name={name} size={19} color={colors.textSecondary} />
    </Pressable>
  );

  return (
    <View
      style={[
        {
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          gap: spacing.sm,
        },
        divider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.divider,
        },
      ]}
      testID={`file-row-${item.id}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          item.isFolder
            ? t('files.openFolder', { name: item.name })
            : t('files.previewFile', { name: item.name })
        }
        onPress={() => (item.isFolder ? onOpenFolder(item) : onPreview(item))}
        testID={`file-open-row-${item.id}`}
        style={[styles.row, { gap: spacing.md }]}
      >
        <View
          style={[
            styles.tile,
            {
              borderRadius: radius.md,
              backgroundColor: item.isFolder
                ? colors.primarySoft
                : colors.surfaceMuted,
            },
          ]}
        >
          {thumbnail ? (
            <Image
              source={{ uri: sizedThumbnail(item.thumbnailLink, 160) }}
              style={[styles.thumb, { borderRadius: radius.md }]}
              onError={() => setThumbFailed(true)}
              accessibilityIgnoresInvertColors
              testID={`file-thumb-${item.id}`}
            />
          ) : (
            <Icon
              name={icon}
              size={20}
              color={item.isFolder ? colors.primaryText : colors.textSecondary}
            />
          )}
        </View>
        <View style={styles.flex}>
          <Text
            style={[typography.label, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {meta || item.shared ? (
            <Text style={caption} numberOfLines={1}>
              {[meta, item.shared ? t('files.shared') : '']
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
          {item.description && !editing ? (
            <Text style={caption} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
        </View>
        {busy ? <ActivityIndicator color={colors.primary} /> : null}
        {item.isFolder ? (
          <Icon name="chevronRight" size={18} color={colors.textSecondary} />
        ) : null}
      </Pressable>

      {!item.isFolder && !editing ? (
        <View style={[styles.row, styles.actions]}>
          {action(
            'link',
            t('files.shareLink'),
            () => onShare(item),
            `file-share-${item.id}`,
          )}
          {action(
            'externalLink',
            t('files.open'),
            () => onOpen(item),
            `file-open-${item.id}`,
          )}
          {action(
            'pencil',
            t('files.editDescription'),
            () => {
              setDraft(item.description);
              setEditing(true);
            },
            `file-edit-${item.id}`,
          )}
          {action(
            'trash2',
            t('files.delete'),
            () => onDelete(item),
            `file-delete-${item.id}`,
          )}
        </View>
      ) : null}

      {editing ? (
        <View style={{ gap: spacing.sm }}>
          <TextInput
            testID={`file-description-${item.id}`}
            accessibilityLabel={t('files.editDescription')}
            value={draft}
            onChangeText={setDraft}
            maxLength={500}
            multiline
            autoFocus
            style={[
              typography.body,
              styles.input,
              {
                color: colors.textPrimary,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                borderRadius: radius.md,
                padding: spacing.md,
              },
            ]}
          />
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Button
              size="sm"
              variant="ghost"
              label={t('files.cancel')}
              onPress={() => setEditing(false)}
              style={styles.flex}
            />
            <Button
              size="sm"
              label={t('files.save')}
              loading={busy}
              onPress={() => {
                void onSaveDescription(item, draft).then(
                  ok => ok && setEditing(false),
                );
              }}
              style={styles.flex}
              testID={`file-save-description-${item.id}`}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  actions: { justifyContent: 'flex-end', gap: 4 },
  flex: { flex: 1, minWidth: 0 },
  thumb: { width: 48, height: 48 },
  tile: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  action: {
    width: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: { borderWidth: 1, minHeight: 72, textAlignVertical: 'top' },
});
