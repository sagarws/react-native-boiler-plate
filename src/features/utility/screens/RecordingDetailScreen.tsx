import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainStackParamList } from '@/navigation/types';
import {
  Button,
  Card,
  EmptyState,
  Header,
  ListRow,
  Notice,
  StatusPill,
  TextField,
} from '@/shared/components';
import { formatDuration, formatTimestamp, logger } from '@/shared/utils';
import { useTheme } from '@/theme';
import { useRecorderStatus, useRecordings } from '../hooks/useRecorder';
import { recorderNative } from '../services/recorder.service';
import {
  canMerge,
  canPlay,
  displayDurationMs,
  formatBytes,
  isBusy,
  mergeableSegments,
  resolutionLabel,
  statusTone,
} from '../services/recordings';

/**
 * One library entry: preview, file facts, actions (play/preview, edit a
 * screenshot, share, rename, merge or re-merge kept parts, delete) and, for
 * a segmented session, its timeline and each part's status.
 */
export default function RecordingDetailScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'UtilityRecording'>>();
  const { recordings, loading } = useRecordings();
  const { status } = useRecorderStatus();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: 'error' | 'success' | 'info';
    text: string;
  } | null>(null);

  const rec = recordings.find(r => r.id === params.recordingId);

  if (!rec) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <Header label={t('recorder.library')} />
        {loading ? null : (
          <EmptyState icon="monitor" title={t('recorder.notFound')} />
        )}
      </View>
    );
  }

  const duration = displayDurationMs(rec);
  const sessionBusy = isBusy(status.state);
  const fail = (key: string) => setMessage({ tone: 'error', text: t(key) });

  const open = async () => {
    if (!(await recorderNative.open(rec.id))) fail('recorder.openFailed');
  };
  const share = async () => {
    if (!(await recorderNative.share(rec.id))) fail('recorder.shareFailed');
  };
  const edit = async () => {
    if (!(await recorderNative.edit(rec.id))) fail('recorder.openFailed');
  };
  const merge = () => {
    try {
      recorderNative.remerge(rec.id);
      setMessage({ tone: 'info', text: t('recorder.mergeQueued') });
    } catch (error) {
      logger.warn('re-merge failed to start', (error as Error)?.message);
      fail('recorder.error_generic');
    }
  };
  const openPart = async (index: number) => {
    if (!(await recorderNative.openSegment(rec.id, index)))
      fail('recorder.openFailed');
  };
  const saveName = async () => {
    const name = (renaming ?? '').trim();
    if (!name) return;
    try {
      await recorderNative.rename(rec.id, name);
      setRenaming(null);
      setMessage({ tone: 'success', text: t('recorder.renamed') });
    } catch {
      fail('recorder.renameFailed');
    }
  };
  const confirmDelete = () =>
    Alert.alert(t('recorder.deleteTitle'), t('recorder.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('recorder.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await recorderNative.remove(rec.id);
            navigation.goBack();
          } catch {
            fail('recorder.deleteFailed');
          }
        },
      },
    ]);

  const facts: [string, string][] = [
    [t('recorder.factType'), t(`recorder.type_${rec.type}`)],
    [t('recorder.factCreated'), formatTimestamp(rec.createdAt)],
  ];
  if (rec.endedAt)
    facts.push([t('recorder.factEnded'), formatTimestamp(rec.endedAt)]);
  if (rec.type !== 'screenshot' && duration > 0)
    facts.push([t('recorder.factDuration'), formatDuration(duration / 1000)]);
  if (rec.sizeBytes > 0)
    facts.push([t('recorder.factSize'), formatBytes(rec.sizeBytes)]);
  if (rec.width > 0)
    facts.push([
      t('recorder.factResolution'),
      `${rec.width}×${rec.height}${
        rec.type === 'video'
          ? ` (${resolutionLabel(rec.width, rec.height)})`
          : ''
      }`,
    ]);
  if (rec.fps > 0) facts.push([t('recorder.factFps'), String(rec.fps)]);
  if (rec.type !== 'screenshot')
    facts.push([
      t('recorder.factAudio'),
      t(`recorder.audioSource_${rec.audio}`),
    ]);

  const parts = rec.segments;
  const kept = mergeableSegments(rec).length;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={rec.name} />
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
            testID="rec-detail-message"
          />
        ) : null}
        {rec.error ? (
          <Notice
            tone={rec.status === 'failed' ? 'error' : 'warning'}
            message={t(`recorder.error_${rec.error}`, {
              defaultValue: t('recorder.error_generic'),
            })}
          />
        ) : null}

        {rec.thumb ? (
          <Image
            source={{ uri: `file://${rec.thumb}` }}
            resizeMode="contain"
            accessibilityLabel={t('recorder.previewA11y')}
            style={[
              styles.preview,
              { borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
            ]}
          />
        ) : null}

        <View style={styles.between}>
          <StatusPill
            tone={statusTone(rec)}
            label={t(`recorder.status_${rec.status}`)}
            testID="rec-detail-status"
          />
        </View>

        <View style={[styles.wrap, { gap: spacing.sm }]}>
          {canPlay(rec) ? (
            <Button
              size="sm"
              iconName={rec.type === 'screenshot' ? 'eye' : 'play'}
              label={
                rec.type === 'screenshot'
                  ? t('recorder.preview')
                  : t('recorder.play')
              }
              onPress={() => {
                void open();
              }}
              testID="rec-play"
            />
          ) : null}
          {rec.type === 'screenshot' && canPlay(rec) ? (
            <Button
              size="sm"
              variant="secondary"
              iconName="pencil"
              label={t('recorder.edit')}
              onPress={() => {
                void edit();
              }}
              testID="rec-edit"
            />
          ) : null}
          {canPlay(rec) ? (
            <Button
              size="sm"
              variant="secondary"
              iconName="share2"
              label={t('recorder.share')}
              onPress={() => {
                void share();
              }}
              testID="rec-share"
            />
          ) : null}
          {canMerge(rec) ? (
            <Button
              size="sm"
              variant="secondary"
              iconName="refreshCw"
              label={
                rec.status === 'completed'
                  ? t('recorder.remerge')
                  : t('recorder.merge')
              }
              onPress={merge}
              disabled={sessionBusy}
              testID="rec-merge"
            />
          ) : null}
        </View>

        {renaming !== null ? (
          <View style={{ gap: spacing.sm }}>
            <TextField
              label={t('recorder.rename')}
              value={renaming}
              onChangeText={setRenaming}
              autoFocus
              maxLength={120}
              onSubmitEditing={() => {
                void saveName();
              }}
              testID="rec-rename-input"
            />
            <View style={[styles.wrap, { gap: spacing.sm }]}>
              <Button
                size="sm"
                label={t('recorder.save')}
                onPress={() => {
                  void saveName();
                }}
                testID="rec-rename-save"
              />
              <Button
                size="sm"
                variant="ghost"
                label={t('common.cancel')}
                onPress={() => setRenaming(null)}
              />
            </View>
          </View>
        ) : null}

        <Card flat>
          {facts.map(([label, value], i) => (
            <ListRow
              key={label}
              divider={i > 0}
              title={label}
              right={
                <Text
                  style={[typography.body, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {value}
                </Text>
              }
            />
          ))}
        </Card>

        {parts.length > 0 ? (
          <>
            <Text
              accessibilityRole="header"
              style={[typography.overline, { color: colors.textSecondary }]}
            >
              {t('recorder.session')}
            </Text>
            <Card flat testID="rec-session">
              <ListRow
                title={t('recorder.segmentCount')}
                right={
                  <Text
                    style={[typography.body, { color: colors.textSecondary }]}
                  >
                    {String(parts.length)}
                  </Text>
                }
              />
              <ListRow
                divider
                title={t('recorder.segmentDuration')}
                right={
                  <Text
                    style={[typography.body, { color: colors.textSecondary }]}
                  >
                    {rec.segmentMinutes > 0
                      ? t('recorder.minutes', { count: rec.segmentMinutes })
                      : t('recorder.notSegmented')}
                  </Text>
                }
              />
              <ListRow
                divider
                title={t('recorder.mergeStatus')}
                subtitle={
                  rec.uri
                    ? t('recorder.finalOutput', { name: rec.name })
                    : undefined
                }
                right={
                  <Text
                    style={[typography.body, { color: colors.textSecondary }]}
                  >
                    {t(`recorder.status_${rec.status}`)}
                  </Text>
                }
              />
              {parts.map(p => (
                <ListRow
                  key={p.index}
                  divider
                  icon="layers"
                  title={t('recorder.part', { n: p.index + 1 })}
                  subtitle={[
                    t(`recorder.seg_${p.status}`),
                    p.durationUs > 0
                      ? formatDuration(p.durationUs / 1_000_000)
                      : null,
                    p.sizeBytes > 0 ? formatBytes(p.sizeBytes) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  chevron={p.status === 'done'}
                  onPress={
                    p.status === 'done'
                      ? () => {
                          void openPart(p.index);
                        }
                      : undefined
                  }
                  testID={`rec-part-${p.index}`}
                />
              ))}
            </Card>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {kept > 0
                ? t('recorder.partsKept', { count: kept })
                : t('recorder.partsDeleted')}
            </Text>
          </>
        ) : null}

        <Card flat>
          {renaming === null ? (
            <ListRow
              icon="pencil"
              title={t('recorder.rename')}
              onPress={() => setRenaming(rec.name.replace(/\.[^.]+$/, ''))}
              disabled={
                rec.status === 'recording' || rec.status === 'processing'
              }
              testID="rec-rename"
            />
          ) : null}
          <ListRow
            divider={renaming === null}
            destructive
            icon="trash2"
            title={t('recorder.delete')}
            onPress={confirmDelete}
            disabled={rec.status === 'recording' || rec.status === 'processing'}
            testID="rec-delete"
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  preview: { width: '100%', height: 240 },
  between: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
