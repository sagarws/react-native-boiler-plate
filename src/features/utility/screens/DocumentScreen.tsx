import React, { useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FormField } from '@/features/life';
import type { MainStackParamList } from '@/navigation/types';
import type { IconName } from '@/shared/assets';
import { Button, EmptyState, Header, Icon, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import { useUtilityData } from '../hooks/useUtility';
import { utilityNative } from '../services/native.service';
import { utilityStore } from '../store/utility.store';
import { MAX_PAGES } from './DocumentsScreen';

const move = <T,>(list: T[], from: number, to: number): T[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

/**
 * One scanned document: rename; reorder, rotate, retake or remove pages; add
 * more pages; export as a multi-page PDF or as JPEG/PNG images to a place
 * the user picks; or share the PDF.
 */
export default function DocumentScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'UtilityDocument'>>();
  const { documents } = useUtilityData();
  const doc = documents.find(d => d.id === params.documentId);
  const [name, setName] = useState(doc?.name ?? '');
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!doc) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <Header label={t('utility.tool_documents')} />
        <EmptyState icon="fileText" title={t('utility.docMissing')} />
      </View>
    );
  }

  const setPages = (pages: string[]) =>
    utilityStore.updateDocument(doc.id, { pages });
  const run = async (key: string, job: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setMessage(null);
    try {
      await job();
    } catch {
      setMessage({ tone: 'error', text: t('utility.docActionFailed') });
    } finally {
      setBusy(null);
    }
  };

  const rotate = (i: number) =>
    run(`rotate-${i}`, async () => {
      const path = await utilityNative.rotate(doc.pages[i], 90);
      setPages(doc.pages.map((p, j) => (j === i ? path : p)));
    });

  const retake = (i: number) =>
    run(`retake-${i}`, async () => {
      const pages = await utilityNative.scanDocument(1);
      if (!pages?.length) return;
      utilityNative.deleteFiles([doc.pages[i]]);
      setPages(doc.pages.map((p, j) => (j === i ? pages[0] : p)));
    });

  const remove = (i: number) =>
    Alert.alert(
      t('utility.removePageTitle'),
      t('utility.removePageBody', { page: i + 1 }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('utility.removePage'),
          style: 'destructive',
          onPress: () => {
            utilityNative.deleteFiles([doc.pages[i]]);
            setPages(doc.pages.filter((_, j) => j !== i));
          },
        },
      ],
    );

  const addPages = () =>
    run('add', async () => {
      const pages = await utilityNative.scanDocument(
        Math.max(1, MAX_PAGES - doc.pages.length),
      );
      if (pages?.length) setPages([...doc.pages, ...pages]);
    });

  const exportAs = (kind: 'pdf' | 'jpeg' | 'png') =>
    run(`export-${kind}`, async () => {
      if (kind === 'pdf') {
        const saved = await utilityNative.exportPdf(doc.pages, doc.name);
        if (saved)
          setMessage({ tone: 'success', text: t('utility.exportedPdf') });
      } else {
        const count = await utilityNative.exportImages(
          doc.pages,
          kind,
          doc.name,
        );
        if (count > 0)
          setMessage({
            tone: 'success',
            text: t('utility.exportedImages', { count }),
          });
      }
    });

  const share = () =>
    run('share', async () => {
      const ok = await utilityNative.sharePdf(doc.pages, doc.name);
      if (!ok) setMessage({ tone: 'error', text: t('utility.shareFailed') });
    });

  const deleteDoc = () =>
    Alert.alert(
      t('utility.deleteDocTitle'),
      t('utility.deleteDocBody', { name: doc.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('utility.delete'),
          style: 'destructive',
          onPress: () => {
            utilityNative.deleteFiles(utilityStore.deleteDocument(doc.id));
            navigation.goBack();
          },
        },
      ],
    );

  const columns = width >= 600 ? 3 : 2;
  const thumbWidth =
    (width - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;
  const tool = (
    icon: IconName,
    label: string,
    onPress: () => void,
    id: string,
    disabled = false,
  ) => (
    <Pressable
      onPress={onPress}
      disabled={disabled || !!busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      testID={id}
      style={[
        styles.tool,
        {
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceMuted,
        },
        disabled && styles.disabled,
      ]}
    >
      <Icon name={icon} size={16} color={colors.textPrimary} />
    </Pressable>
  );

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={doc.name} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {message ? (
          <Notice
            tone={message.tone}
            message={message.text}
            onDismiss={() => setMessage(null)}
          />
        ) : null}
        <FormField
          label={t('utility.docName')}
          value={name}
          onChangeText={setName}
          onEndEditing={() => utilityStore.updateDocument(doc.id, { name })}
          maxLength={80}
          testID="doc-name"
        />
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('utility.pages', { count: doc.pages.length })} ·{' '}
          {t('utility.pagesHint')}
        </Text>

        {doc.pages.length ? (
          <View style={[styles.grid, { gap: spacing.md }]}>
            {doc.pages.map((page, i) => (
              <View
                key={page}
                style={{ width: thumbWidth, gap: spacing.xs }}
                testID={`page-${i}`}
              >
                <Pressable
                  onPress={() => setPreview(page)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={t('utility.pageN', { page: i + 1 })}
                >
                  <Image
                    source={{ uri: `file://${page}` }}
                    resizeMode="contain"
                    style={[
                      {
                        width: thumbWidth,
                        height: thumbWidth * 1.35,
                        borderRadius: radius.md,
                        backgroundColor: colors.surfaceMuted,
                      },
                    ]}
                  />
                </Pressable>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('utility.pageN', { page: i + 1 })}
                </Text>
                <View style={[styles.tools, { gap: spacing.xs }]}>
                  {tool(
                    'arrowUp',
                    t('utility.moveEarlier'),
                    () => setPages(move(doc.pages, i, i - 1)),
                    `page-${i}-up`,
                    i === 0,
                  )}
                  {tool(
                    'arrowDown',
                    t('utility.moveLater'),
                    () => setPages(move(doc.pages, i, i + 1)),
                    `page-${i}-down`,
                    i === doc.pages.length - 1,
                  )}
                  {tool(
                    'rotateCw',
                    t('utility.rotate'),
                    () => {
                      void rotate(i);
                    },
                    `page-${i}-rotate`,
                  )}
                  {tool(
                    'camera',
                    t('utility.retake'),
                    () => {
                      void retake(i);
                    },
                    `page-${i}-retake`,
                  )}
                  {tool(
                    'trash2',
                    t('utility.removePage'),
                    () => remove(i),
                    `page-${i}-remove`,
                  )}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState compact icon="fileText" title={t('utility.noPages')} />
        )}

        <Button
          variant="soft"
          iconName="plus"
          label={t('utility.addPages')}
          onPress={() => {
            void addPages();
          }}
          loading={busy === 'add'}
          testID="doc-add"
        />
        <Text
          style={[
            typography.title,
            { color: colors.textPrimary, marginTop: spacing.sm },
          ]}
        >
          {t('utility.export')}
        </Text>
        <Button
          iconName="download"
          label={t('utility.exportPdf')}
          onPress={() => {
            void exportAs('pdf');
          }}
          loading={busy === 'export-pdf'}
          disabled={!doc.pages.length}
          testID="doc-export-pdf"
        />
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            style={styles.flex}
            variant="soft"
            label={t('utility.exportJpeg')}
            onPress={() => {
              void exportAs('jpeg');
            }}
            loading={busy === 'export-jpeg'}
            disabled={!doc.pages.length}
            testID="doc-export-jpeg"
          />
          <Button
            style={styles.flex}
            variant="soft"
            label={t('utility.exportPng')}
            onPress={() => {
              void exportAs('png');
            }}
            loading={busy === 'export-png'}
            disabled={!doc.pages.length}
            testID="doc-export-png"
          />
        </View>
        <Button
          variant="soft"
          iconName="share2"
          label={t('utility.sharePdf')}
          onPress={() => {
            void share();
          }}
          loading={busy === 'share'}
          disabled={!doc.pages.length}
          testID="doc-share"
        />
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('utility.exportHint')}
        </Text>
        <Button
          variant="danger"
          label={t('utility.deleteDoc')}
          onPress={deleteDoc}
          testID="doc-delete"
        />
      </ScrollView>

      <Modal
        visible={!!preview}
        transparent
        animationType="fade"
        onRequestClose={() => setPreview(null)}
      >
        <Pressable
          style={[styles.previewScrim, { backgroundColor: colors.overlay }]}
          onPress={() => setPreview(null)}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          {preview ? (
            <Image
              source={{ uri: `file://${preview}` }}
              resizeMode="contain"
              style={styles.previewImage}
            />
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  tools: { flexDirection: 'row', flexWrap: 'wrap' },
  disabled: { opacity: 0.35 },
  tool: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewScrim: { flex: 1, padding: 16, justifyContent: 'center' },
  previewImage: { width: '100%', height: '90%' },
});
