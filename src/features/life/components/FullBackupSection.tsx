import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Notice, ToggleSwitch } from '@/shared/components';
import { useTheme } from '@/theme';
import { useFullBackup } from '../hooks/useFullBackup';

const ERRORS = new Set([
  'not_zip',
  'not_backup',
  'newer_schema',
  'corrupt',
  'bad_json',
  'unsafe_entry',
  'duplicate_entry',
  'too_large',
  'no_manifest',
  'bad_manifest',
  'unavailable',
  'export_failed',
  'restore_failed',
]);

/**
 * Backup & restore → Full backup: everything in Manage Life (including the
 * Long-Term Planner) as one ZIP, a planner-only JSON export, and a staged
 * restore that previews the archive before anything changes.
 */
export function FullBackupSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const b = useFullBackup();
  const { status } = b;
  const busy = (what: string) => status.kind === 'busy' && status.what === what;
  const caption = [typography.caption, { color: colors.textSecondary }];
  const label = [typography.label, { color: colors.textPrimary }];

  const confirmReplace = () =>
    Alert.alert(t('life.zipReplaceTitle'), t('life.zipReplaceBody'), [
      { text: t('life.cancel'), style: 'cancel' },
      {
        text: t('life.backupReplace'),
        style: 'destructive',
        onPress: () => b.restore('replace'),
      },
    ]);

  return (
    <View style={{ gap: spacing.sm }} testID="full-backup">
      <Text style={label}>{t('life.zipTitle')}</Text>
      <Text style={caption}>{t('life.zipHint')}</Text>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Text
          style={[typography.body, styles.flex, { color: colors.textPrimary }]}
        >
          {t('life.zipAttachments')}
        </Text>
        <ToggleSwitch
          isOn={b.includeAttachments}
          onToggle={b.setIncludeAttachments}
          accessibilityLabel={t('life.zipAttachments')}
        />
      </View>
      <Button
        label={t('life.zipExport')}
        iconName="download"
        onPress={() => b.exportZip()}
        loading={busy('export')}
        disabled={!b.available}
        testID="zip-export"
      />
      <Button
        variant="secondary"
        label={t('life.plannerExport')}
        onPress={() => b.exportPlanner()}
        loading={busy('plannerExport')}
        disabled={!b.available}
        testID="planner-export"
      />
      {status.kind !== 'review' ? (
        <Button
          variant="secondary"
          label={t('life.zipImport')}
          iconName="upload"
          onPress={() => b.choose()}
          loading={busy('read') || busy('restore')}
          disabled={!b.available}
          testID="zip-import"
        />
      ) : null}

      {status.kind === 'review' ? (
        <Card testID="zip-review">
          <View style={{ gap: spacing.sm }}>
            <Text style={label}>{t('life.backupFound')}</Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {t('life.zipCounts', status.pending.parsed.counts)}
            </Text>
            <Text style={caption}>
              {t('life.zipMeta', {
                date: status.pending.parsed.manifest.exportedAt
                  ? new Date(
                      status.pending.parsed.manifest.exportedAt,
                    ).toLocaleString()
                  : '–',
                version: status.pending.parsed.manifest.appVersion || '–',
                files: Object.keys(status.pending.parsed.staged).length,
              })}
            </Text>
            {status.pending.parsed.duplicates ||
            status.pending.parsed.repaired ? (
              <Notice
                tone="warning"
                message={t('life.zipIssues', {
                  duplicates: status.pending.parsed.duplicates,
                  repaired: status.pending.parsed.repaired,
                })}
              />
            ) : null}
            <Text style={caption}>{t('life.zipMergeHint')}</Text>
            <Button
              label={t('life.backupMerge')}
              iconName="plus"
              onPress={() => b.restore('merge')}
              testID="zip-merge"
            />
            <Button
              variant="danger"
              label={t('life.backupReplace')}
              onPress={confirmReplace}
              testID="zip-replace"
            />
            <Button
              variant="ghost"
              label={t('life.cancel')}
              onPress={b.cancel}
              testID="zip-cancel"
            />
          </View>
        </Card>
      ) : null}

      {status.kind === 'exported' ? (
        <Notice
          tone="success"
          message={t('life.backupExported')}
          testID="zip-message"
        />
      ) : null}
      {status.kind === 'restored' ? (
        <Notice
          tone="success"
          title={t(
            status.mode === 'replace'
              ? 'life.backupReplaced'
              : 'life.backupMerged',
          )}
          message={t('life.zipResult', {
            projects: status.summary.life?.projects ?? 0,
            tasks: status.summary.life?.tasks ?? 0,
            plans: status.summary.planner?.projects ?? 0,
            nodes: status.summary.planner?.nodes ?? 0,
            files: status.summary.attachments,
          })}
          testID="zip-message"
        />
      ) : null}
      {status.kind === 'error' ? (
        <Notice
          tone="error"
          message={t(
            ERRORS.has(status.code)
              ? `life.zipError_${status.code}`
              : 'life.backupError_generic',
          )}
          testID="zip-message"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
