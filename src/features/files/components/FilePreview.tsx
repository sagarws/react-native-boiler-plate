import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import { driveRepository } from '../repository/drive.repository';
import type { DriveItem } from '../types';
import {
  fileKind,
  formatSize,
  formatWhen,
  sizedThumbnail,
} from '../utils/format';

export interface FilePreviewProps {
  /** The file to show; null hides the preview. */
  item: DriveItem | null;
  onClose: () => void;
  onShare: (item: DriveItem) => void;
}

type ImageSource = { uri: string; headers?: Record<string, string> };

/**
 * Full-screen preview of a Drive file:
 * - images: the full image (authorized request to Drive);
 * - text: the first 64 KB;
 * - PDFs, videos, documents: Drive's large thumbnail (first page / frame);
 * - anything else: its details.
 * "Open in Google Drive" covers what an app can't render (playing video,
 * paging through a PDF).
 */
export function FilePreview({ item, onClose, onShare }: FilePreviewProps) {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const [image, setImage] = useState<ImageSource | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const kind = item ? fileKind(item.mimeType, item.name) : 'other';

  useEffect(() => {
    setImage(null);
    setText(null);
    setFailed(false);
    if (!item) return undefined;
    let live = true;
    const done = () => live && setLoading(false);
    setLoading(true);
    if (kind === 'image') {
      driveRepository
        .mediaSource(item.id)
        .then(source => live && setImage(source))
        .catch(() => {
          // Fall back to Drive's large thumbnail.
          if (live && item.thumbnailLink)
            setImage({ uri: sizedThumbnail(item.thumbnailLink, 1600) });
          else if (live) setFailed(true);
        })
        .finally(done);
    } else if (kind === 'text') {
      driveRepository
        .readText(item.id)
        .then(content => live && setText(content))
        .catch(() => live && setFailed(true))
        .finally(done);
    } else {
      if (item.thumbnailLink)
        setImage({ uri: sizedThumbnail(item.thumbnailLink, 1600) });
      setLoading(false);
    }
    return () => {
      live = false;
    };
  }, [item, kind]);

  if (!item) return null;

  const meta = [formatSize(item.size), formatWhen(item.modifiedAt)]
    .filter(Boolean)
    .join(' · ');
  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <View
          style={[
            styles.bar,
            {
              paddingHorizontal: spacing.sm,
              borderBottomColor: colors.divider,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('files.closePreview')}
            onPress={onClose}
            style={styles.iconButton}
            testID="preview-close"
          >
            <Icon name="x" size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.flex}>
            <Text
              style={[typography.label, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {meta ? <Text style={caption}>{meta}</Text> : null}
          </View>
        </View>

        <View
          style={[styles.stage, { backgroundColor: colors.surfaceMuted }]}
          testID="preview-stage"
        >
          {loading ? (
            <ActivityIndicator color={colors.primary} size="large" />
          ) : text !== null ? (
            <ScrollView
              style={styles.fill}
              contentContainerStyle={{ padding: spacing.lg }}
            >
              <Text
                selectable
                style={[
                  typography.body,
                  styles.mono,
                  { color: colors.textPrimary },
                ]}
                testID="preview-text"
              >
                {text}
              </Text>
            </ScrollView>
          ) : image && !failed ? (
            <>
              <Image
                source={image}
                resizeMode="contain"
                style={styles.fill}
                onError={() => setFailed(true)}
                accessibilityLabel={item.name}
                testID="preview-image"
              />
              {kind === 'video' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('files.playInDrive')}
                  onPress={() => {
                    if (item.webViewLink)
                      void Linking.openURL(item.webViewLink);
                  }}
                  style={[
                    styles.play,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Icon
                    name="play"
                    size={28}
                    color={colors.primaryForeground}
                  />
                </Pressable>
              ) : null}
            </>
          ) : (
            <View
              style={[styles.empty, { gap: spacing.sm, padding: spacing.xl }]}
              testID="preview-none"
            >
              <Icon name="scanText" size={48} color={colors.textSecondary} />
              <Text
                style={[
                  typography.body,
                  styles.center,
                  { color: colors.textSecondary },
                ]}
              >
                {t('files.noPreview')}
              </Text>
            </View>
          )}
        </View>

        {item.description ? (
          <Text
            style={[
              caption,
              { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
            ]}
          >
            {item.description}
          </Text>
        ) : null}
        <View
          style={[
            styles.actions,
            {
              padding: spacing.lg,
              paddingBottom: bottom + spacing.lg,
              gap: spacing.sm,
            },
          ]}
        >
          <Button
            variant="soft"
            iconName="link"
            label={t('files.shareLink')}
            onPress={() => onShare(item)}
            style={styles.flex}
            testID="preview-share"
          />
          <Button
            iconName="externalLink"
            label={t('files.openInDrive')}
            onPress={() => {
              if (item.webViewLink) void Linking.openURL(item.webViewLink);
            }}
            disabled={!item.webViewLink}
            style={styles.flex}
            testID="preview-open"
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1, minWidth: 0 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', height: '100%' },
  mono: { fontFamily: 'monospace' },
  play: {
    position: 'absolute',
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { alignItems: 'center' },
  center: { textAlign: 'center' },
  actions: { flexDirection: 'row' },
});
