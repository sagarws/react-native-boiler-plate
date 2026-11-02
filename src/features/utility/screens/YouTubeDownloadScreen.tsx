import React, { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  ChoiceList,
  EmptyState,
  Header,
  Icon,
  ListRow,
  Notice,
  SegmentedControl,
  TextField,
} from '@/shared/components';
import { formatDuration } from '@/shared/utils/time';
import { useTheme } from '@/theme';
import { useYouTubeDownloader } from '../hooks/useYouTubeDownloader';
import { formatBytes } from '../services/recordings';
import { errorKey } from '../services/youtube';
import type {
  DownloadEntry,
  DownloadKind,
  DownloadOption,
} from '../youtube.types';

const MODES: readonly DownloadKind[] = ['video', 'audio'];

/**
 * Utility → YouTube Downloader: paste a link, pick a video quality (up to
 * 4K) or audio only, and download in the background. Files go to the
 * phone's Movies/Akshar or Music/Akshar folder.
 */
export default function YouTubeDownloadScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const yt = useYouTubeDownloader();
  const [link, setLink] = useState('');

  const optionDescription = (o: DownloadOption) =>
    [
      o.ext.toUpperCase(),
      o.codec,
      o.sizeBytes > 0
        ? t('utility.yt.approxSize', { size: formatBytes(o.sizeBytes) })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const optionHint = (o: DownloadOption | undefined) => {
    if (!o) return null;
    if (o.kind === 'audio') return t('utility.yt.hint_audio');
    if (o.ext === 'webm') return t('utility.yt.hint_webm');
    if (o.codec === 'AV1') return t('utility.yt.hint_av1');
    return t('utility.yt.hint_mp4');
  };

  const confirmRemove = (entry: DownloadEntry) =>
    Alert.alert(t('utility.yt.removeTitle'), entry.title, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('utility.yt.removeFromList'),
        onPress: () => {
          yt.remove(entry.id, false);
        },
      },
      {
        text: t('utility.yt.deleteFile'),
        style: 'destructive',
        onPress: () => {
          yt.remove(entry.id, true);
        },
      },
    ]);

  const openEntry = async (id: string) => {
    if (!(await yt.open(id))) Alert.alert(t('utility.yt.openFailed'));
  };

  const selected = yt.options.find(o => o.id === yt.selectedId);
  const busy = yt.active != null || yt.starting;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_youtube')} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {!yt.available && (
          <Notice
            tone="warning"
            message={t('utility.yt.error_unavailable_platform')}
          />
        )}
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('utility.yt.rightsNote')}
        </Text>

        <TextField
          label={t('utility.yt.linkLabel')}
          placeholder={t('utility.yt.linkPlaceholder')}
          value={link}
          onChangeText={next => {
            setLink(next);
            if (yt.lookup.kind !== 'idle') yt.reset();
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="search"
          onSubmitEditing={() => {
            yt.fetchInfo(link);
          }}
          testID="yt-link"
        />
        <Button
          label={t('utility.yt.getVideo')}
          iconName="search"
          onPress={() => {
            yt.fetchInfo(link);
          }}
          disabled={!link.trim() || !yt.available}
          loading={yt.lookup.kind === 'loading'}
          testID="yt-fetch"
        />

        {yt.lookup.kind === 'loading' && (
          <Text
            style={[typography.caption, { color: colors.textSecondary }]}
            accessibilityLiveRegion="polite"
          >
            {t('utility.yt.reading')}
          </Text>
        )}
        {yt.lookup.kind === 'error' && (
          <Notice
            tone="error"
            message={t(errorKey(yt.lookup.code))}
            testID="yt-lookup-error"
          />
        )}

        {yt.lookup.kind === 'ready' && (
          <>
            <Card testID="yt-details">
              <View style={{ gap: spacing.sm }}>
                {!!yt.lookup.details.thumbnail && (
                  <Image
                    source={{ uri: yt.lookup.details.thumbnail }}
                    style={[styles.thumb, { borderRadius: radius.md }]}
                    accessibilityIgnoresInvertColors
                    accessible={false}
                  />
                )}
                <Text
                  style={[typography.label, { color: colors.textPrimary }]}
                  numberOfLines={3}
                >
                  {yt.lookup.details.title}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {[
                    yt.lookup.details.author,
                    yt.lookup.details.durationSec > 0
                      ? formatDuration(yt.lookup.details.durationSec)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </Card>

            <SegmentedControl
              options={MODES.map(m => ({
                value: m,
                label: t(`utility.yt.mode_${m}`),
              }))}
              value={yt.mode}
              onChange={yt.setMode}
              accessibilityLabel={t('utility.yt.modeLabel')}
              testID="yt-mode"
            />

            {yt.options.length === 0 ? (
              <Notice tone="info" message={t(`utility.yt.none_${yt.mode}`)} />
            ) : (
              <ChoiceList
                choices={yt.options.map((o, i) => ({
                  value: o.id,
                  title: o.label,
                  description: optionDescription(o),
                  badge: i === 0 ? t('utility.yt.best') : undefined,
                }))}
                value={yt.selectedId ?? ''}
                onChange={yt.select}
                accessibilityLabel={t('utility.yt.qualityLabel')}
                testID="yt-quality"
              />
            )}
            {selected && (
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {optionHint(selected)}
              </Text>
            )}

            <Button
              label={
                yt.mode === 'audio'
                  ? t('utility.yt.downloadAudio')
                  : t('utility.yt.downloadVideo')
              }
              iconName="download"
              onPress={() => {
                yt.download();
              }}
              disabled={!selected || busy}
              loading={yt.starting}
              testID="yt-download"
            />
          </>
        )}

        {yt.active && (
          <Card testID="yt-active">
            <View style={{ gap: spacing.sm }}>
              <Text
                style={[typography.label, { color: colors.textPrimary }]}
                numberOfLines={2}
              >
                {yt.active.title}
              </Text>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t(`utility.yt.phase_${yt.active.phase}`)}
                {yt.active.label ? ` · ${yt.active.label}` : ''}
                {` · ${Math.round(yt.active.fraction * 100)}%`}
              </Text>
              <View
                style={[
                  styles.track,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.sm,
                  },
                ]}
                accessibilityRole="progressbar"
                accessibilityLabel={t('utility.yt.progressLabel')}
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round(yt.active.fraction * 100),
                }}
              >
                <View
                  style={[
                    styles.fill,
                    {
                      width: `${Math.round(yt.active.fraction * 100)}%`,
                      backgroundColor: colors.primary,
                      borderRadius: radius.sm,
                    },
                  ]}
                />
              </View>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t('utility.yt.backgroundNote')}
              </Text>
              <Button
                label={t('common.cancel')}
                variant="secondary"
                size="sm"
                onPress={yt.cancel}
                testID="yt-cancel"
              />
            </View>
          </Card>
        )}

        {yt.justCompleted && (
          <Notice
            tone="success"
            title={t('utility.yt.doneTitle')}
            message={t(
              yt.justCompleted.kind === 'audio'
                ? 'utility.yt.doneAudio'
                : 'utility.yt.doneVideo',
              { name: yt.justCompleted.name },
            )}
            action={{
              label: t('utility.yt.open'),
              onPress: () => {
                openEntry(yt.justCompleted!.id);
              },
            }}
            onDismiss={yt.dismiss}
            testID="yt-done"
          />
        )}
        {yt.downloadError && (
          <Notice
            tone="error"
            message={t(errorKey(yt.downloadError))}
            onDismiss={yt.dismiss}
            testID="yt-download-error"
          />
        )}

        <Text
          style={[
            typography.label,
            { color: colors.textPrimary, marginTop: spacing.md },
          ]}
          accessibilityRole="header"
        >
          {t('utility.yt.downloadsTitle')}
        </Text>
        {yt.downloads.length === 0 ? (
          <EmptyState
            icon="download"
            title={t('utility.yt.emptyTitle')}
            message={t('utility.yt.emptyMessage')}
            compact
            testID="yt-empty"
          />
        ) : (
          yt.downloads.map((entry, index) => (
            <ListRow
              key={entry.id}
              icon={entry.kind === 'audio' ? 'audioLines' : 'play'}
              title={entry.title || entry.name}
              subtitle={[entry.label, formatBytes(entry.sizeBytes)].join(' · ')}
              onPress={() => {
                openEntry(entry.id);
              }}
              divider={index < yt.downloads.length - 1}
              accessibilityHint={t('utility.yt.openHint')}
              testID={`yt-entry-${entry.id}`}
              right={
                <View style={[styles.actions, { gap: spacing.sm }]}>
                  <Pressable
                    onPress={() => {
                      yt.share(entry.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('utility.yt.share')}
                    hitSlop={spacing.sm}
                  >
                    <Icon
                      name="upload"
                      size={20}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => confirmRemove(entry)}
                    accessibilityRole="button"
                    accessibilityLabel={t('utility.yt.remove')}
                    hitSlop={spacing.sm}
                    testID={`yt-remove-${entry.id}`}
                  >
                    <Icon name="x" size={20} color={colors.textSecondary} />
                  </Pressable>
                </View>
              }
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  thumb: { width: '100%', aspectRatio: 16 / 9 },
  track: { height: 8, overflow: 'hidden' },
  fill: { height: '100%' },
  actions: { flexDirection: 'row', alignItems: 'center' },
});
