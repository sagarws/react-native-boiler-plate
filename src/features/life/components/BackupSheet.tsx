import React from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Icon, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import { useLifeBackup } from '../hooks/useLifeBackup';
import { FullBackupSection } from './FullBackupSection';

const ERRORS = new Set([
  'not_xlsx',
  'not_backup',
  'newer_format',
  'too_large',
  'unavailable',
  'export_failed',
]);

export interface BackupSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Backup & restore: export all Manage Life data to an Excel file, or import
 * one — first showing what it contains, then merging or replacing.
 */
export function BackupSheet({ visible, onClose }: BackupSheetProps) {
  const { t } = useTranslation();
  const { bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const backup = useLifeBackup();
  const { status } = backup;

  const close = () => {
    backup.reset();
    onClose();
  };

  const confirmReplace = () =>
    Alert.alert(t('life.backupReplaceTitle'), t('life.backupReplaceMessage'), [
      { text: t('life.cancel'), style: 'cancel' },
      {
        text: t('life.backupReplace'),
        style: 'destructive',
        onPress: () => backup.restore('replace'),
      },
    ]);

  const label = [typography.label, { color: colors.textPrimary }];
  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={close}
    >
      <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingBottom: bottom + spacing.md,
            },
          ]}
        >
          <View style={[styles.row, { padding: spacing.lg }]}>
            <Text
              style={[
                typography.title,
                styles.flex,
                { color: colors.textPrimary },
              ]}
              accessibilityRole="header"
            >
              {t('life.backupTitle')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={close}
              style={styles.close}
              testID="backup-close"
            >
              <Icon name="x" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              gap: spacing.md,
            }}
          >
            {!backup.available ? (
              <Notice
                tone="warning"
                message={t('life.backupError_unavailable')}
              />
            ) : null}

            <FullBackupSection />
            <View
              style={[styles.divider, { backgroundColor: colors.divider }]}
            />

            <View style={{ gap: spacing.sm }}>
              <Text style={label}>{t('life.backupExportTitle')}</Text>
              <Text style={caption}>{t('life.backupExportHint')}</Text>
              <Button
                label={t('life.backupExport')}
                iconName="download"
                onPress={() => {
                  backup.exportBackup();
                }}
                loading={status.kind === 'exporting'}
                disabled={!backup.available}
                testID="backup-export"
              />
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <Text style={label}>{t('life.backupImportTitle')}</Text>
              <Text style={caption}>{t('life.backupImportHint')}</Text>
              {status.kind !== 'review' ? (
                <Button
                  variant="secondary"
                  label={t('life.backupImport')}
                  iconName="upload"
                  onPress={() => {
                    backup.chooseBackup();
                  }}
                  loading={status.kind === 'reading'}
                  disabled={!backup.available}
                  testID="backup-import"
                />
              ) : null}
            </View>

            {status.kind === 'review' ? (
              <Card testID="backup-review">
                <View style={{ gap: spacing.sm }}>
                  <Text style={label}>{t('life.backupFound')}</Text>
                  <Text
                    style={[typography.body, { color: colors.textPrimary }]}
                  >
                    {t('life.backupCounts', status.pending.counts)}
                  </Text>
                  {status.pending.exportedAt ? (
                    <Text style={caption}>
                      {t('life.backupMadeOn', {
                        date: new Date(
                          status.pending.exportedAt,
                        ).toLocaleString(),
                      })}
                    </Text>
                  ) : null}
                  <Text style={caption}>{t('life.backupMergeHint')}</Text>
                  <Button
                    label={t('life.backupMerge')}
                    iconName="plus"
                    onPress={() => backup.restore('merge')}
                    testID="backup-merge"
                  />
                  <Button
                    variant="danger"
                    label={t('life.backupReplace')}
                    onPress={confirmReplace}
                    testID="backup-replace"
                  />
                  <Button
                    variant="ghost"
                    label={t('life.cancel')}
                    onPress={backup.reset}
                    testID="backup-cancel"
                  />
                </View>
              </Card>
            ) : null}

            {status.kind === 'exported' ? (
              <Notice
                tone="success"
                message={t('life.backupExported')}
                testID="backup-message"
              />
            ) : null}
            {status.kind === 'imported' ? (
              <Notice
                tone="success"
                title={t(
                  status.mode === 'replace'
                    ? 'life.backupReplaced'
                    : 'life.backupMerged',
                )}
                message={
                  t('life.backupResult', { ...status.summary }) +
                  (status.summary.skipped
                    ? ` ${t('life.backupSkipped', {
                        count: status.summary.skipped,
                      })}`
                    : '')
                }
                testID="backup-message"
              />
            ) : null}
            {status.kind === 'error' ? (
              <Notice
                tone="error"
                message={t(
                  ERRORS.has(status.code)
                    ? `life.backupError_${status.code}`
                    : 'life.backupError_generic',
                )}
                testID="backup-message"
              />
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
