import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  PixelRatio,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { filePreviewService, type PreviewError } from '@/features/capture';
import { useTheme } from '@/theme';
import { driveRepository } from '../repository/drive.repository';
import type { DriveItem } from '../types';

export interface PdfPagesProps {
  item: DriveItem;
  /** Rendering isn't possible (download failed, too large…). */
  onFailed: (code: PreviewError) => void;
}

/** Pixel width pages are rendered at: the screen width, capped for memory. */
const MAX_RENDER_WIDTH = 1600;
const A4_RATIO = 1.414;

/**
 * Every page of a Drive PDF, scrolled vertically. The file is downloaded
 * once to the app cache; each page is rendered (Android's PdfRenderer) only
 * when the list gets near it.
 */
export function PdfPages({ item, onFailed }: PdfPagesProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { width } = useWindowDimensions();
  const [doc, setDoc] = useState<{ path: string; pages: number } | null>(null);
  const renderWidth = Math.min(
    MAX_RENDER_WIDTH,
    Math.round(width * PixelRatio.get()),
  );

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const source = await driveRepository.mediaSource(item.id);
        const path = await filePreviewService.download(
          source.uri,
          source.headers.Authorization ?? '',
        );
        const pages = await filePreviewService.pdfPageCount(path);
        if (live) setDoc({ path, pages });
      } catch (error) {
        if (live)
          onFailed(
            ((error as { code?: PreviewError }).code ??
              'preview_failed') as PreviewError,
          );
      }
    })();
    return () => {
      live = false;
    };
    // One load per file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  if (!doc) {
    return (
      <View style={[styles.center, { gap: spacing.sm }]} testID="pdf-loading">
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('files.pdfLoading')}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      testID="pdf-pages"
      data={Array.from({ length: doc.pages }, (_, i) => i)}
      keyExtractor={i => String(i)}
      initialNumToRender={2}
      windowSize={5}
      contentContainerStyle={{ padding: spacing.sm, gap: spacing.sm }}
      renderItem={({ item: index }) => (
        <PdfPage
          path={doc.path}
          index={index}
          total={doc.pages}
          renderWidth={renderWidth}
          displayWidth={width - spacing.sm * 2}
        />
      )}
    />
  );
}

interface PdfPageProps {
  path: string;
  index: number;
  total: number;
  renderWidth: number;
  displayWidth: number;
}

function PdfPage({
  path,
  index,
  total,
  renderWidth,
  displayWidth,
}: PdfPageProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [ratio, setRatio] = useState(A4_RATIO);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    filePreviewService
      .renderPdfPage(path, index, renderWidth)
      .then(next => live && setUri(next))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [path, index, renderWidth]);

  return (
    <View
      style={[
        styles.page,
        {
          width: displayWidth,
          height: displayWidth * ratio,
          backgroundColor: colors.surface,
          borderRadius: radius.sm,
        },
      ]}
      testID={`pdf-page-${index}`}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.fill}
          resizeMode="contain"
          onLoad={e => {
            const { width: w, height: h } = e.nativeEvent.source;
            if (w > 0) setRatio(h / w);
          }}
          accessibilityLabel={t('files.pdfPage', { page: index + 1, total })}
        />
      ) : failed ? (
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('files.pdfPageFailed')}
        </Text>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
      <Text
        style={[
          typography.caption,
          styles.badge,
          {
            color: colors.textSecondary,
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.sm,
            paddingHorizontal: spacing.sm,
          },
        ]}
      >
        {t('files.pdfPage', { page: index + 1, total })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  badge: { position: 'absolute', bottom: 6, right: 6 },
});
