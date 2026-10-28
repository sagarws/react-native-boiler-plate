import React, { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDay } from '@/features/life';
import { Button, Card, EmptyState, Header, Notice } from '@/shared/components';
import { toDayKey } from '@/shared/utils/dayKey';
import { useTheme } from '@/theme';
import { ROUTES } from '@/navigation/routes';
import { useUtilityData } from '../hooks/useUtility';
import { utilityNative } from '../services/native.service';
import { utilityStore } from '../store/utility.store';

/** Pages per scanning session (Google's scanner caps a session itself too). */
export const MAX_PAGES = 30;

/**
 * Scanned documents. "Scan" opens Google's on-device document scanner
 * (edges found automatically, corners adjustable, perspective corrected,
 * filters); the pages are kept privately until exported or deleted.
 */
export default function DocumentsScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { documents } = useUtilityData();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    utilityNative
      .documentScannerAvailable()
      .then(setAvailable, () => setAvailable(false));
  }, []);

  const scan = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const pages = await utilityNative.scanDocument(MAX_PAGES);
      if (pages?.length) {
        const stamp = new Date();
        const name = t('utility.docDefaultName', {
          date: formatDay(toDayKey(stamp)),
          time: `${String(stamp.getHours()).padStart(2, '0')}${String(
            stamp.getMinutes(),
          ).padStart(2, '0')}`,
        });
        const doc = utilityStore.createDocument(name, pages);
        navigation.navigate(ROUTES.UTILITY_DOCUMENT, { documentId: doc.id });
      }
    } catch {
      setError(t('utility.scanFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_documents')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {available === false ? (
          <Notice
            tone="warning"
            title={t('utility.docsUnavailableTitle')}
            message={t('utility.docsUnavailable')}
            testID="docs-unavailable"
          />
        ) : null}
        {error ? (
          <Notice
            tone="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        ) : null}
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {t('utility.docsIntro')}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('utility.docsPrivacy')}
            </Text>
          </View>
        </Card>
        <Button
          label={t('utility.scanDocument')}
          iconName="camera"
          onPress={() => {
            void scan();
          }}
          loading={busy}
          disabled={available === false}
          testID="docs-scan"
        />
        {documents.length ? (
          documents.map(doc => (
            <Pressable
              key={doc.id}
              onPress={() =>
                navigation.navigate(ROUTES.UTILITY_DOCUMENT, {
                  documentId: doc.id,
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`${doc.name}, ${t('utility.pages', {
                count: doc.pages.length,
              })}`}
              style={[
                styles.row,
                {
                  gap: spacing.md,
                  padding: spacing.sm,
                  borderRadius: radius.lg,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
              testID={`doc-${doc.id}`}
            >
              {doc.pages[0] ? (
                <Image
                  source={{ uri: `file://${doc.pages[0]}` }}
                  style={[styles.thumb, { borderRadius: radius.sm }]}
                />
              ) : (
                <View
                  style={[
                    styles.thumb,
                    { backgroundColor: colors.surfaceMuted },
                  ]}
                />
              )}
              <View style={styles.flex}>
                <Text
                  style={[typography.label, { color: colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {doc.name}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('utility.pages', { count: doc.pages.length })} ·{' '}
                  {formatDay(toDayKey(new Date(doc.updatedAt)))}
                </Text>
              </View>
            </Pressable>
          ))
        ) : (
          <EmptyState
            compact
            icon="fileText"
            title={t('utility.noDocuments')}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
  thumb: { width: 48, height: 64 },
});
