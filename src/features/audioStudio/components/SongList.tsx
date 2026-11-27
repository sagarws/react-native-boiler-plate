import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import { useCollections, useCurrentSong } from '../hooks/useAudioStudio';
import { collectionsService } from '../services/collections.service';
import { formatDuration } from '../services/library.service';
import { playerService } from '../services/player.service';
import type { Song } from '../types';
import { ActionSheet, Artwork, NameDialog } from './ui';

export const ROW_HEIGHT = 64;

export function SongRow({
  song,
  onPress,
  onMore,
  active,
  liked,
  right,
}: {
  song: Song;
  onPress: () => void;
  onMore?: () => void;
  active?: boolean;
  liked?: boolean;
  right?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMore}
      accessibilityRole="button"
      accessibilityLabel={`${song.title}, ${song.artist}`}
      style={({ pressed }) => [
        styles.row,
        { paddingHorizontal: spacing.lg, gap: spacing.md },
        pressed && { backgroundColor: colors.primarySoft },
      ]}
    >
      <Artwork uri={song.artUri} size={44} />
      <View style={styles.flex}>
        <Text
          numberOfLines={1}
          style={[
            typography.label,
            { color: active ? colors.primary : colors.textPrimary },
          ]}
        >
          {song.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[typography.caption, { color: colors.textSecondary }]}
        >
          {[
            song.artist || t('audioStudio.library.unknownArtist'),
            formatDuration(song.durationMs),
          ].join(' · ')}
        </Text>
      </View>
      {liked ? <Icon name="heart" size={16} color={colors.primary} /> : null}
      {right}
      {onMore ? (
        <Pressable
          onPress={onMore}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('audioStudio.song.more')}
        >
          <Icon name="circleEllipsis" size={20} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** Song actions: play next, queue, like, add to playlist. */
export function useSongActions() {
  const { t } = useTranslation();
  const collections = useCollections();
  const [target, setTarget] = useState<Song | null>(null);
  const [pickPlaylist, setPickPlaylist] = useState<Song | null>(null);
  const [newPlaylistFor, setNewPlaylistFor] = useState<Song | null>(null);

  const sheet = (
    <>
      <ActionSheet
        visible={!!target}
        title={target?.title ?? ''}
        onClose={() => setTarget(null)}
        actions={
          target
            ? [
                {
                  label: t('audioStudio.song.playNext'),
                  icon: 'skipForward',
                  onPress: () => playerService.playNext([target]),
                },
                {
                  label: t('audioStudio.song.addToQueue'),
                  icon: 'listMusic',
                  onPress: () => playerService.addToQueue([target]),
                },
                {
                  label:
                    target.id in collections.liked
                      ? t('audioStudio.song.unlike')
                      : t('audioStudio.song.like'),
                  icon: 'heart',
                  onPress: () => collectionsService.toggleLike(target.id),
                },
                {
                  label: t('audioStudio.song.addToPlaylist'),
                  icon: 'plus',
                  onPress: () => setPickPlaylist(target),
                },
              ]
            : []
        }
      />
      <ActionSheet
        visible={!!pickPlaylist}
        title={t('audioStudio.song.addToPlaylist')}
        onClose={() => setPickPlaylist(null)}
        actions={[
          ...collections.playlists.map(p => ({
            label: p.name,
            icon: 'listMusic' as const,
            onPress: () =>
              pickPlaylist && collectionsService.addSongs(p.id, [pickPlaylist]),
          })),
          {
            label: t('audioStudio.playlists.new'),
            icon: 'plus',
            onPress: () => setNewPlaylistFor(pickPlaylist),
          },
        ]}
      />
      <NameDialog
        visible={!!newPlaylistFor}
        title={t('audioStudio.playlists.new')}
        onClose={() => setNewPlaylistFor(null)}
        onSubmit={name =>
          newPlaylistFor &&
          collectionsService.createPlaylist(name, [newPlaylistFor.id])
        }
      />
    </>
  );
  return { open: setTarget, sheet };
}

/** A virtualised song list (handles thousands of songs). */
export function SongList({
  songs,
  header,
  empty,
  onPlay,
}: {
  songs: Song[];
  header?: React.ReactElement;
  empty?: React.ReactElement;
  /** Default: play this list from the tapped song. */
  onPlay?: (index: number) => void;
}) {
  const current = useCurrentSong();
  const { liked } = useCollections();
  const actions = useSongActions();
  const renderItem = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <SongRow
        song={item}
        active={current?.id === item.id}
        liked={item.id in liked}
        onPress={() =>
          onPlay ? onPlay(index) : playerService.playSongs(songs, index)
        }
        onMore={() => actions.open(item)}
      />
    ),
    [current?.id, liked, onPlay, songs, actions],
  );
  return (
    <>
      <FlatList
        data={songs}
        keyExtractor={s => s.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        initialNumToRender={14}
        windowSize={9}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
      />
      {actions.sheet}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center' },
});
