import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import type { MainStackParamList } from '@/navigation/types';
import {
  EmptyState,
  Header,
  Icon,
  Notice,
  StatusPill,
  TabBar,
} from '@/shared/components';
import { formatDuration, formatTimestamp } from '@/shared/utils';
import { useTheme } from '@/theme';
import { useRecordings } from '../hooks/useRecorder';
import {
  displayDurationMs,
  filterRecordings,
  formatBytes,
  resolutionLabel,
  statusTone,
} from '../services/recordings';
import {
  LIBRARY_FILTERS,
  type LibraryFilter,
  type Recording,
} from '../recorder.types';

const TYPE_ICON = {
  screenshot: 'image',
  video: 'monitor',
  audio: 'audioLines',
} as const;

/**
 * Utility → Recordings: screenshots, screen and voice recordings, newest
 * first, with tabs for each type and for sessions still processing, cut off
 * (interrupted) or failed. Only verified files show as completed; an
 * unfinished session never looks like a finished recording.
 */
export default function RecordingsScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'UtilityRecordings'>>();
  const { recordings, loading, error, refresh } = useRecordings();
  const [filter, setFilter] = useState<LibraryFilter>(params?.filter ?? 'all');

  useEffect(() => {
    if (params?.filter) setFilter(params.filter);
  }, [params?.filter]);

  const list = useMemo(
    () => filterRecordings(recordings, filter),
    [recordings, filter],
  );

  const renderItem: ListRenderItem<Recording> = ({ item }) => {
    const duration = displayDurationMs(item);
    const facts = [
      t(`recorder.type_${item.type}`),
      formatTimestamp(item.createdAt),
      item.type !== 'screenshot' && duration > 0
        ? formatDuration(duration / 1000)
        : null,
      item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : null,
      item.type === 'video'
        ? [
            resolutionLabel(item.width, item.height),
            item.fps ? `${item.fps} fps` : '',
          ]
            .filter(Boolean)
            .join(' ')
        : null,
      item.type !== 'screenshot' && item.audio !== 'none'
        ? t(`recorder.audioSource_${item.audio}`)
        : null,
    ].filter(Boolean);
    return (
      <Pressable
        onPress={() =>
          navigation.navigate(ROUTES.UTILITY_RECORDING, {
            recordingId: item.id,
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`${item.name}. ${facts.join(', ')}. ${t(
          `recorder.status_${item.status}`,
        )}`}
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
        testID={`rec-item-${item.id}`}
      >
        {item.thumb ? (
          <Image
            source={{ uri: `file://${item.thumb}` }}
            style={[styles.thumb, { borderRadius: radius.sm }]}
          />
        ) : (
          <View
            style={[
              styles.thumb,
              styles.center,
              { backgroundColor: colors.surfaceMuted, borderRadius: radius.sm },
            ]}
          >
            <Icon
              name={TYPE_ICON[item.type]}
              size={24}
              color={colors.textSecondary}
            />
          </View>
        )}
        <View style={[styles.flex, { gap: spacing.xs }]}>
          <Text
            style={[typography.label, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Text
            style={[typography.caption, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {facts.join(' · ')}
          </Text>
          <StatusPill
            tone={statusTone(item)}
            label={t(`recorder.status_${item.status}`)}
          />
        </View>
      </Pressable>
    );
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('recorder.library')} />
      <TabBar
        value={filter}
        onChange={setFilter}
        scrollable
        accessibilityLabel={t('recorder.filtersLabel')}
        testID="rec-filter"
        tabs={LIBRARY_FILTERS.map(f => ({
          value: f,
          label: t(`recorder.filter_${f}`),
        }))}
      />
      <FlatList
        data={list}
        keyExtractor={r => r.id}
        renderItem={renderItem}
        onRefresh={() => {
          void refresh();
        }}
        refreshing={false}
        contentContainerStyle={[
          styles.grow,
          {
            padding: spacing.lg,
            paddingBottom: bottom + spacing.xl,
            gap: spacing.sm,
          },
        ]}
        ListHeaderComponent={
          error ? (
            <Notice tone="error" message={t('recorder.libraryFailed')} />
          ) : null
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="monitor"
              title={t('recorder.libraryEmpty')}
              message={t('recorder.libraryEmptyHint')}
              testID="rec-empty"
            />
          )
        }
        testID="rec-list"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grow: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 64, height: 64 },
});
