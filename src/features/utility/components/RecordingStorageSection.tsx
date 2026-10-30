import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ExpandableCard,
  Notice,
  StatusPill,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { recorderNative } from '../services/recorder.service';
import { formatBytes } from '../services/recordings';
import {
  OUTPUT_KINDS,
  type DirectoryStatus,
  type OutputKind,
} from '../recorder.types';

type Message = { kind: OutputKind; tone: 'success' | 'error'; text: string };

/**
 * Save folders, one per kind. "Change" opens Android's folder picker
 * (Storage Access Framework, persisted grant — no storage permission);
 * "Default" goes back to Pictures/Movies/Recordings → Akshar; "Test"
 * writes and deletes a small file. A folder whose access was revoked shows
 * "No access" and blocks recording until it's chosen again.
 */
export function RecordingStorageSection({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [dirs, setDirs] = useState<
    Partial<Record<OutputKind, DirectoryStatus>>
  >({});
  const [busy, setBusy] = useState<OutputKind | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(() => {
    recorderNative.directories().then(setDirs, () => setDirs({}));
  }, []);

  useEffect(() => {
    if (expanded) load();
  }, [expanded, load]);

  const missing = OUTPUT_KINDS.filter(k => dirs[k] && !dirs[k]?.accessible);

  const change = async (kind: OutputKind) => {
    setBusy(kind);
    setMessage(null);
    try {
      const picked = await recorderNative.pickDirectory(kind);
      if (picked) load();
    } catch {
      setMessage({ kind, tone: 'error', text: t('recorder.dirPickFailed') });
    } finally {
      setBusy(null);
    }
  };

  const reset = async (kind: OutputKind) => {
    await recorderNative.clearDirectory(kind);
    load();
  };

  const test = async (kind: OutputKind) => {
    setBusy(kind);
    const ok = await recorderNative.testDirectory(kind).catch(() => false);
    setBusy(null);
    setMessage({
      kind,
      tone: ok ? 'success' : 'error',
      text: ok ? t('recorder.dirTestOk') : t('recorder.dirTestFailed'),
    });
  };

  return (
    <ExpandableCard
      title={t('recorder.sectionStorage')}
      summary={
        missing.length
          ? t('recorder.summaryStorageMissing', { count: missing.length })
          : t('recorder.summaryStorage')
      }
      icon="folder"
      footer={t('recorder.storageFooter')}
      padded
      testID="rec-section-storage"
      expanded={expanded}
      onToggle={onToggle}
    >
      <View style={{ gap: spacing.lg }}>
        {OUTPUT_KINDS.map(kind => {
          const dir = dirs[kind];
          return (
            <View
              key={kind}
              style={{ gap: spacing.sm }}
              testID={`rec-dir-${kind}`}
            >
              <View style={styles.between}>
                <Text style={[typography.label, { color: colors.textPrimary }]}>
                  {t(`recorder.dir_${kind}`)}
                </Text>
                {dir ? (
                  <StatusPill
                    tone={dir.accessible ? 'success' : 'error'}
                    label={
                      dir.accessible
                        ? t('recorder.dirAccessible')
                        : t('recorder.dirNoAccess')
                    }
                  />
                ) : null}
              </View>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
                numberOfLines={2}
              >
                {dir
                  ? `${
                      dir.custom
                        ? dir.label
                        : t('recorder.dirDefault', { path: dir.label })
                    }${
                      dir.freeBytes > 0
                        ? ` · ${t('recorder.free', {
                            size: formatBytes(dir.freeBytes),
                          })}`
                        : ''
                    }`
                  : t(`recorder.dirHint_${kind}`)}
              </Text>
              <View style={[styles.row, { gap: spacing.sm }]}>
                <Button
                  size="sm"
                  variant="secondary"
                  label={t('recorder.dirChange')}
                  onPress={() => {
                    void change(kind);
                  }}
                  loading={busy === kind}
                  testID={`rec-dir-change-${kind}`}
                />
                {dir?.custom ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    label={t('recorder.dirUseDefault')}
                    onPress={() => {
                      void reset(kind);
                    }}
                  />
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  label={t('recorder.dirTest')}
                  onPress={() => {
                    void test(kind);
                  }}
                  disabled={busy === kind}
                />
              </View>
              {message?.kind === kind ? (
                <Notice
                  tone={message.tone}
                  message={message.text}
                  onDismiss={() => setMessage(null)}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </ExpandableCard>
  );
}

const styles = StyleSheet.create({
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
