import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import {
  useCollections,
  useLibraryInfo,
  useSongs,
} from '../hooks/useAudioStudio';
import { collectionsService } from '../services/collections.service';
import {
  groupSongs,
  libraryService,
  searchSongs,
  sortSongs,
  type Group,
  type GroupBy,
  type ScanResult,
  type SortKey,
} from '../services/library.service';
import { playerService } from '../services/player.service';
import type { Playlist, Song } from '../types';
import { DragHandle } from './PlayerViews';
import { ROW_HEIGHT, SongList, SongRow } from './SongList';
import {
  ActionSheet,
  Artwork,
  Chip,
  ChipRow,
  IconButton,
  NameDialog,
} from './ui';

type View_ =
  | 'songs'
  | 'albums'
  | 'artists'
  | 'genres'
  | 'folders'
  | 'liked'
  | 'playlists'
  | 'recent'
  | 'added';

const VIEWS: View_[] = [
  'songs',
  'liked',
  'playlists',
  'albums',
  'artists',
  'genres',
  'folders',
  'recent',
  'added',
];
const SORTS: SortKey[] = ['title', 'artist', 'album', 'dateAdded', 'duration'];

type Detail =
  | { kind: 'group'; group: Group }
  | { kind: 'playlist'; id: string };

export function LibraryView() {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const songs = useSongs();
  const info = useLibraryInfo();
  const collections = useCollections();
  const [view, setView] = useState<View_>('songs');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('title');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [scan, setScan] = useState<ScanResult | 'busy' | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [newPlaylist, setNewPlaylist] = useState(false);

  const byId = useMemo(() => new Map(songs.map(s => [s.id, s])), [songs]);
  const lookup = (ids: string[]) =>
    ids.map(id => byId.get(id)).filter((s): s is Song => !!s);

  const rescan = async () => {
    setScan('busy');
    setScan(await libraryService.scan());
  };

  const list = useMemo((): Song[] => {
    switch (view) {
      case 'liked':
        return sortSongs(
          lookup(Object.keys(collections.liked)),
          sort === 'dateAdded' ? 'title' : sort,
        ).sort((a, b) =>
          sort === 'dateAdded'
            ? (collections.liked[b.id] ?? 0) - (collections.liked[a.id] ?? 0)
            : 0,
        );
      case 'recent':
        return lookup(collections.recent.map(r => r.id));
      case 'added':
        return sortSongs(songs, 'dateAdded').slice(0, 100);
      default:
        return sortSongs(songs, sort);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, songs, sort, collections]);

  const filtered = useMemo(() => searchSongs(list, query), [list, query]);
  const groups = useMemo(
    () =>
      view === 'albums' ||
      view === 'artists' ||
      view === 'genres' ||
      view === 'folders'
        ? groupSongs(
            searchSongs(songs, query),
            view.slice(0, -1) as GroupBy,
            t('audioStudio.library.unknown'),
          )
        : [],
    [view, songs, query, t],
  );

  if (detail?.kind === 'group')
    return <GroupDetail group={detail.group} onBack={() => setDetail(null)} />;
  if (detail?.kind === 'playlist') {
    const p = collections.playlists.find(x => x.id === detail.id);
    if (p)
      return (
        <PlaylistDetail
          playlist={p}
          songs={lookup(p.songIds)}
          onBack={() => setDetail(null)}
        />
      );
  }

  const needsScan =
    info.scannedAt === null || scan === 'denied' || scan === 'blocked';

  const header = (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      <View
        style={[
          styles.search,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            gap: spacing.sm,
          },
        ]}
      >
        <Icon name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('audioStudio.library.search')}
          placeholderTextColor={colors.placeholder}
          style={[typography.body, styles.flex, { color: colors.textPrimary }]}
          testID="studio-search"
        />
        {query ? (
          <IconButton
            icon="x"
            size={18}
            label={t('common.clear')}
            onPress={() => setQuery('')}
          />
        ) : null}
      </View>
      <ChipRow>
        {VIEWS.map(v => (
          <Chip
            key={v}
            label={t(`audioStudio.library.views.${v}`)}
            active={view === v}
            onPress={() => setView(v)}
            testID={`studio-lib-${v}`}
          />
        ))}
      </ChipRow>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Text
          style={[
            typography.caption,
            styles.flex,
            { color: colors.textSecondary },
          ]}
        >
          {view === 'playlists'
            ? t('audioStudio.library.playlistCount', {
                count: collections.playlists.length,
              })
            : groups.length
            ? t('audioStudio.library.groupCount', { count: groups.length })
            : t('audioStudio.library.songCount', { count: filtered.length })}
        </Text>
        {view === 'playlists' ? (
          <Chip
            label={t('audioStudio.playlists.new')}
            icon="plus"
            onPress={() => setNewPlaylist(true)}
            testID="studio-new-playlist"
          />
        ) : (
          <>
            {['songs', 'liked'].includes(view) ? (
              <Chip
                label={t(`audioStudio.library.sort.${sort}`)}
                icon="filter"
                onPress={() => setSortOpen(true)}
              />
            ) : null}
            <Chip
              label={t('audioStudio.library.import')}
              icon="upload"
              onPress={() =>
                libraryService.importFiles().catch(() => undefined)
              }
              testID="studio-import"
            />
            <IconButton
              icon="refreshCw"
              size={18}
              label={t('audioStudio.library.rescan')}
              onPress={rescan}
            />
          </>
        )}
      </View>
      {['songs', 'liked', 'recent', 'added'].includes(view) &&
      filtered.length > 0 ? (
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            label={t('audioStudio.common.playAll')}
            iconName="play"
            size="sm"
            onPress={() => playerService.playSongs(filtered, 0)}
            style={styles.flex}
            testID="studio-play-all"
          />
          <Button
            label={t('audioStudio.common.shuffle')}
            iconName="shuffle"
            size="sm"
            variant="soft"
            onPress={() => playerService.playSongs(filtered, 0, true)}
            style={styles.flex}
          />
        </View>
      ) : null}
      {needsScan && view === 'songs' ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            {scan === 'blocked'
              ? t('audioStudio.library.permissionBlocked')
              : t('audioStudio.library.permissionWhy')}
          </Text>
          <Button
            label={
              scan === 'blocked'
                ? t('audioStudio.library.openSettings')
                : t('audioStudio.library.allow')
            }
            onPress={scan === 'blocked' ? () => Linking.openSettings() : rescan}
            loading={scan === 'busy'}
          />
        </View>
      ) : null}
    </View>
  );

  const sheets = (
    <>
      <ActionSheet
        visible={sortOpen}
        title={t('audioStudio.library.sortBy')}
        onClose={() => setSortOpen(false)}
        actions={SORTS.map(k => ({
          label: t(`audioStudio.library.sort.${k}`),
          icon: 'filter' as const,
          onPress: () => setSort(k),
        }))}
      />
      <NameDialog
        visible={newPlaylist}
        title={t('audioStudio.playlists.new')}
        onClose={() => setNewPlaylist(false)}
        onSubmit={n => collectionsService.createPlaylist(n)}
      />
    </>
  );

  if (view === 'playlists')
    return (
      <View style={styles.flex}>
        <FlatList
          data={collections.playlists}
          keyExtractor={p => p.id}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              icon="listMusic"
              title={t('audioStudio.playlists.empty')}
              compact
            />
          }
          renderItem={({ item }) => (
            <GroupRow
              title={item.name}
              subtitle={t('audioStudio.library.songCount', {
                count: item.songIds.length,
              })}
              artUri={item.cover ?? lookup(item.songIds)[0]?.artUri ?? null}
              onPress={() => setDetail({ kind: 'playlist', id: item.id })}
            />
          )}
        />
        {sheets}
      </View>
    );

  if (
    groups.length ||
    ['albums', 'artists', 'genres', 'folders'].includes(view)
  )
    return (
      <View style={styles.flex}>
        <FlatList
          data={groups}
          keyExtractor={g => g.key}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              icon="music"
              title={t('audioStudio.library.empty')}
              compact
            />
          }
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          renderItem={({ item }) => (
            <GroupRow
              title={item.title}
              subtitle={[
                item.subtitle,
                t('audioStudio.library.songCount', {
                  count: item.songs.length,
                }),
              ]
                .filter(Boolean)
                .join(' · ')}
              artUri={item.artUri}
              onPress={() => setDetail({ kind: 'group', group: item })}
            />
          )}
        />
        {sheets}
      </View>
    );

  return (
    <View style={styles.flex}>
      <SongList
        songs={filtered}
        header={header}
        empty={
          needsScan ? undefined : (
            <EmptyState
              icon={view === 'liked' ? 'heart' : 'music'}
              title={t(
                view === 'liked'
                  ? 'audioStudio.library.noLiked'
                  : 'audioStudio.library.empty',
              )}
              compact
            />
          )
        }
      />
      {sheets}
    </View>
  );
}

function GroupRow({
  title,
  subtitle,
  artUri,
  onPress,
}: {
  title: string;
  subtitle: string;
  artUri: string | null;
  onPress: () => void;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.groupRow,
        { paddingHorizontal: spacing.lg, gap: spacing.md },
        pressed && { backgroundColor: colors.primarySoft },
      ]}
    >
      <Artwork uri={artUri} size={44} />
      <View style={styles.flex}>
        <Text
          numberOfLines={1}
          style={[typography.label, { color: colors.textPrimary }]}
        >
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={[typography.caption, { color: colors.textSecondary }]}
        >
          {subtitle}
        </Text>
      </View>
      <Icon name="chevronRight" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

function DetailHeader({
  title,
  subtitle,
  artUri,
  onBack,
  songs,
  children,
}: {
  title: string;
  subtitle: string;
  artUri: string | null;
  onBack: () => void;
  songs: Song[];
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        style={[styles.row, { gap: spacing.xs }]}
        hitSlop={8}
      >
        <Icon name="chevronLeft" size={20} color={colors.primary} />
        <Text style={[typography.label, { color: colors.primary }]}>
          {t('audioStudio.common.back')}
        </Text>
      </Pressable>
      <View style={[styles.row, { gap: spacing.md }]}>
        <Artwork uri={artUri} size={88} />
        <View style={styles.flex}>
          <Text
            numberOfLines={2}
            style={[typography.h2, { color: colors.textPrimary }]}
          >
            {title}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {subtitle}
          </Text>
        </View>
      </View>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Button
          label={t('audioStudio.common.playAll')}
          iconName="play"
          size="sm"
          disabled={!songs.length}
          onPress={() => playerService.playSongs(songs, 0)}
          style={styles.flex}
        />
        <Button
          label={t('audioStudio.common.shuffle')}
          iconName="shuffle"
          size="sm"
          variant="soft"
          disabled={!songs.length}
          onPress={() => playerService.playSongs(songs, 0, true)}
          style={styles.flex}
        />
        <IconButton
          icon="listMusic"
          label={t('audioStudio.song.addToQueue')}
          onPress={() => playerService.addToQueue(songs)}
          disabled={!songs.length}
        />
      </View>
      {children}
    </View>
  );
}

function GroupDetail({ group, onBack }: { group: Group; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <SongList
      songs={group.songs}
      header={
        <DetailHeader
          title={group.title}
          subtitle={t('audioStudio.library.songCount', {
            count: group.songs.length,
          })}
          artUri={group.artUri}
          songs={group.songs}
          onBack={onBack}
        />
      }
    />
  );
}

function PlaylistDetail({
  playlist,
  songs,
  onBack,
}: {
  playlist: Playlist;
  songs: Song[];
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [rename, setRename] = useState(false);
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState<{ index: number; dy: number } | null>(null);

  const remove = () =>
    Alert.alert(t('audioStudio.playlists.deleteTitle'), playlist.name, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('audioStudio.playlists.delete'),
        style: 'destructive',
        onPress: () => {
          onBack();
          collectionsService.deletePlaylist(playlist.id);
        },
      },
    ]);

  return (
    <View style={styles.flex} testID="studio-playlist-detail">
      <FlatList
        data={songs}
        keyExtractor={(s, i) => `${s.id}-${i}`}
        scrollEnabled={!drag}
        ListHeaderComponent={
          <DetailHeader
            title={playlist.name}
            subtitle={t('audioStudio.library.songCount', {
              count: songs.length,
            })}
            artUri={playlist.cover ?? songs[0]?.artUri ?? null}
            songs={songs}
            onBack={onBack}
          >
            <ChipRow>
              <Chip
                label={t('audioStudio.playlists.edit')}
                icon="pencil"
                onPress={() => setMenu(true)}
                testID="studio-playlist-edit"
              />
            </ChipRow>
          </DetailHeader>
        }
        ListEmptyComponent={
          <EmptyState
            icon="listMusic"
            title={t('audioStudio.playlists.noSongs')}
            compact
          />
        }
        renderItem={({ item, index }) => (
          <View
            style={
              drag?.index === index
                ? {
                    transform: [{ translateY: drag.dy }],
                    zIndex: 2,
                    elevation: 6,
                    backgroundColor: colors.surface,
                  }
                : undefined
            }
          >
            <SongRow
              song={item}
              onPress={() => playerService.playSongs(songs, index)}
              right={
                <>
                  <IconButton
                    icon="x"
                    size={18}
                    label={t('audioStudio.playlists.removeSong')}
                    onPress={() =>
                      collectionsService.removeSong(playlist.id, index)
                    }
                  />
                  <DragHandle
                    label={t('audioStudio.queue.drag')}
                    onStart={() => setDrag({ index, dy: 0 })}
                    onMove={dy => setDrag({ index, dy })}
                    onDrop={dy => {
                      setDrag(null);
                      const to = Math.max(
                        0,
                        Math.min(
                          songs.length - 1,
                          index + Math.round(dy / ROW_HEIGHT),
                        ),
                      );
                      if (to !== index)
                        collectionsService.moveSong(playlist.id, index, to);
                    }}
                    onCancel={() => setDrag(null)}
                  />
                </>
              }
            />
          </View>
        )}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
      />
      <ActionSheet
        visible={menu}
        title={playlist.name}
        onClose={() => setMenu(false)}
        actions={[
          {
            label: t('audioStudio.playlists.rename'),
            icon: 'pencil',
            onPress: () => setRename(true),
          },
          {
            label: t('audioStudio.playlists.cover'),
            icon: 'image',
            onPress: () => collectionsService.changeCover(playlist.id),
          },
          ...(playlist.cover
            ? [
                {
                  label: t('audioStudio.playlists.removeCover'),
                  icon: 'x' as const,
                  onPress: () => collectionsService.removeCover(playlist.id),
                },
              ]
            : []),
          {
            label: t('audioStudio.playlists.delete'),
            icon: 'x',
            destructive: true,
            onPress: remove,
          },
        ]}
      />
      <NameDialog
        visible={rename}
        title={t('audioStudio.playlists.rename')}
        initial={playlist.name}
        onClose={() => setRename(false)}
        onSubmit={n => collectionsService.renamePlaylist(playlist.id, n)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  groupRow: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center' },
});
