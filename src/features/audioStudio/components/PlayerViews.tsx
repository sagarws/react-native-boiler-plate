import React, { useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, Slider } from '@/shared/components';
import { useTheme } from '@/theme';
import {
  useCollections,
  useCurrentSong,
  usePlayer,
  usePosition,
  useStudio,
} from '../hooks/useAudioStudio';
import { collectionsService } from '../services/collections.service';
import { formatDuration } from '../services/library.service';
import { playerService } from '../services/player.service';
import { studioService } from '../services/studio.service';
import { ROW_HEIGHT, SongRow } from './SongList';
import {
  ActionSheet,
  Artwork,
  Chip,
  ChipRow,
  IconButton,
  NameDialog,
} from './ui';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SLEEP_MINUTES = [5, 15, 30, 45, 60, 90];

/** Compact player shown on the other tabs; tap to open Now Playing. */
export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const s = usePlayer();
  const song = useCurrentSong();
  const pos = usePosition();
  if (!song) return null;
  const progress = s.durationMs > 0 ? Math.min(1, pos / s.durationMs) : 0;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t('audioStudio.player.open')}
      style={[
        styles.mini,
        { backgroundColor: colors.surface, borderTopColor: colors.border },
      ]}
      testID="studio-mini-player"
    >
      <View
        style={[
          styles.miniProgress,
          { backgroundColor: colors.primary, width: `${progress * 100}%` },
        ]}
      />
      <View
        style={[
          styles.rowCenter,
          { paddingHorizontal: spacing.md, gap: spacing.md },
        ]}
      >
        <Artwork uri={song.artUri} size={40} />
        <View style={styles.flex}>
          <Text
            numberOfLines={1}
            style={[typography.label, { color: colors.textPrimary }]}
          >
            {song.title}
          </Text>
          <Text
            numberOfLines={1}
            style={[typography.caption, { color: colors.textSecondary }]}
          >
            {song.artist}
          </Text>
        </View>
        <IconButton
          icon={s.playing ? 'pause' : 'play'}
          label={
            s.playing
              ? t('audioStudio.player.pause')
              : t('audioStudio.player.play')
          }
          onPress={playerService.toggle}
          testID="studio-mini-toggle"
        />
        <IconButton
          icon="skipForward"
          label={t('audioStudio.player.next')}
          onPress={playerService.next}
        />
      </View>
    </Pressable>
  );
}

/** The full player: artwork, seek, transport, modes, speed, sleep, 8D quick switch. */
export function NowPlaying({
  onQueue,
  onStudio,
}: {
  onQueue: () => void;
  onStudio: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const s = usePlayer();
  const song = useCurrentSong();
  const pos = usePosition();
  const { liked } = useCollections();
  const studio = useStudio();
  const [sleepOpen, setSleepOpen] = useState(false);
  const [crossOpen, setCrossOpen] = useState(false);

  if (!song)
    return (
      <View style={[styles.empty, { padding: spacing.xl }]}>
        <Icon name="music" size={48} color={colors.textSecondary} />
        <Text
          style={[
            typography.body,
            styles.centerText,
            { color: colors.textSecondary },
          ]}
        >
          {t('audioStudio.player.nothing')}
        </Text>
      </View>
    );

  const isLiked = song.id in liked;
  const sleepText = s.sleepEndOfTrack
    ? t('audioStudio.player.sleepEnd')
    : s.sleepAt
    ? t('audioStudio.player.sleepIn', {
        min: Math.max(1, Math.round((s.sleepAt - Date.now()) / 60000)),
      })
    : t('audioStudio.player.sleep');

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      testID="studio-now-playing"
    >
      <View style={styles.center}>
        <Artwork uri={song.artUri} size={260} rounded={radius.lg} />
      </View>
      <View style={styles.rowCenter}>
        <View style={styles.flex}>
          <Text
            numberOfLines={2}
            style={[typography.h2, { color: colors.textPrimary }]}
          >
            {song.title}
          </Text>
          <Text
            numberOfLines={1}
            style={[typography.body, { color: colors.textSecondary }]}
          >
            {[song.artist, song.album].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <IconButton
          icon="heart"
          active={isLiked}
          label={
            isLiked ? t('audioStudio.song.unlike') : t('audioStudio.song.like')
          }
          onPress={() => collectionsService.toggleLike(song.id)}
          testID="studio-like"
        />
      </View>

      <View>
        <Slider
          value={Math.min(pos, s.durationMs || pos)}
          min={0}
          max={Math.max(1, s.durationMs)}
          step={1000}
          onChange={playerService.seek}
          accessibilityLabel={t('audioStudio.player.seek')}
          testID="studio-seek"
        />
        <View style={styles.rowCenter}>
          <Text
            style={[
              typography.caption,
              styles.flex,
              { color: colors.textSecondary },
            ]}
          >
            {formatDuration(pos)}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {formatDuration(s.durationMs)}
          </Text>
        </View>
      </View>

      <View style={[styles.rowCenter, styles.spread]}>
        <IconButton
          icon="shuffle"
          active={s.shuffle}
          label={t('audioStudio.player.shuffle')}
          onPress={playerService.toggleShuffle}
          testID="studio-shuffle"
        />
        <IconButton
          icon="skipBack"
          size={32}
          label={t('audioStudio.player.previous')}
          onPress={playerService.previous}
        />
        <Pressable
          onPress={playerService.toggle}
          accessibilityRole="button"
          accessibilityLabel={
            s.playing
              ? t('audioStudio.player.pause')
              : t('audioStudio.player.play')
          }
          style={[styles.playBtn, { backgroundColor: colors.primary }]}
          testID="studio-play"
        >
          <Icon
            name={s.playing ? 'pause' : 'play'}
            size={34}
            color={colors.primaryForeground}
          />
        </Pressable>
        <IconButton
          icon="skipForward"
          size={32}
          label={t('audioStudio.player.next')}
          onPress={playerService.next}
          testID="studio-next"
        />
        <IconButton
          icon={s.repeat === 'one' ? 'repeat1' : 'repeat'}
          active={s.repeat !== 'off'}
          label={t(`audioStudio.player.repeat_${s.repeat}`)}
          onPress={playerService.cycleRepeat}
          testID="studio-repeat"
        />
      </View>

      {s.error ? (
        <Text style={[typography.caption, { color: colors.error }]}>
          {t('audioStudio.player.error', { error: s.error })}
        </Text>
      ) : null}

      <ChipRow>
        <Chip
          label={
            studio.settings.enabled
              ? t('audioStudio.player.eightDOn')
              : t('audioStudio.player.eightDOff')
          }
          icon="headphones"
          active={studio.settings.enabled}
          onPress={() =>
            studioService.update({ enabled: !studio.settings.enabled }, true)
          }
          testID="studio-8d-toggle"
        />
        <Chip
          label={t('audioStudio.tabs.studio')}
          icon="slidersHorizontal"
          onPress={onStudio}
        />
        <Chip
          label={t('audioStudio.player.queue')}
          icon="listMusic"
          onPress={onQueue}
          testID="studio-open-queue"
        />
        <Chip
          label={sleepText}
          icon="timer"
          active={!!s.sleepAt || s.sleepEndOfTrack}
          onPress={() => setSleepOpen(true)}
        />
        <Chip
          label={t('audioStudio.player.crossfade')}
          icon="layers"
          onPress={() => setCrossOpen(true)}
        />
      </ChipRow>

      <View>
        <Text
          style={[
            typography.caption,
            { color: colors.textSecondary, marginBottom: spacing.xs },
          ]}
        >
          {t('audioStudio.player.speed')}
        </Text>
        <ChipRow>
          {SPEEDS.map(v => (
            <Chip
              key={v}
              label={`${v}×`}
              active={Math.abs(s.speed - v) < 0.01}
              onPress={() => playerService.setSpeed(v)}
              testID={`studio-speed-${v}`}
            />
          ))}
        </ChipRow>
      </View>

      <ActionSheet
        visible={sleepOpen}
        title={t('audioStudio.player.sleep')}
        onClose={() => setSleepOpen(false)}
        actions={[
          ...SLEEP_MINUTES.map(m => ({
            label: t('audioStudio.player.minutes', { count: m }),
            icon: 'timer' as const,
            onPress: () => playerService.setSleepTimer(m),
          })),
          {
            label: t('audioStudio.player.sleepEnd'),
            icon: 'music',
            onPress: () => playerService.setSleepTimer(0, true),
          },
          {
            label: t('audioStudio.player.sleepOff'),
            icon: 'x',
            onPress: () => playerService.setSleepTimer(0),
          },
        ]}
      />
      <ActionSheet
        visible={crossOpen}
        title={t('audioStudio.player.crossfade')}
        onClose={() => setCrossOpen(false)}
        actions={[0, 2000, 4000, 6000, 10000].map(ms => ({
          label: ms
            ? t('audioStudio.player.seconds', { count: ms / 1000 })
            : t('audioStudio.player.off'),
          icon: 'layers' as const,
          onPress: () => playerService.setCrossfade(ms),
        }))}
      />
    </ScrollView>
  );
}

/**
 * The queue, reorderable by dragging the handle (rows are a fixed height, so
 * the drop index is the drag distance / row height).
 */
export function QueueView() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const s = usePlayer();
  const items = playerService.queueSongs();
  const [dragging, setDragging] = useState<number | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const dy = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  const onDrop = (from: number, deltaY: number) => {
    const to = Math.max(
      0,
      Math.min(items.length - 1, from + Math.round(deltaY / ROW_HEIGHT)),
    );
    setDragging(null);
    dy.setValue(0);
    playerService.move(from, to);
  };

  return (
    <View style={styles.flex} testID="studio-queue">
      <View
        style={[styles.rowCenter, { padding: spacing.lg, gap: spacing.sm }]}
      >
        <Text
          style={[typography.label, styles.flex, { color: colors.textPrimary }]}
        >
          {t('audioStudio.queue.title', { count: items.length })}
        </Text>
        <Chip
          label={t('audioStudio.queue.save')}
          icon="plus"
          onPress={() => setSaveOpen(true)}
        />
        <Chip
          label={t('audioStudio.queue.clear')}
          icon="x"
          onPress={playerService.clear}
          testID="studio-queue-clear"
        />
      </View>
      <ScrollView ref={scrollRef} scrollEnabled={dragging === null}>
        {items.map(({ song, index }) => {
          const isDragged = dragging === index;
          return (
            <Animated.View
              key={`${song.id}-${index}`}
              style={[
                isDragged && {
                  transform: [{ translateY: dy }],
                  zIndex: 2,
                  elevation: 6,
                  backgroundColor: colors.surface,
                },
              ]}
            >
              <SongRow
                song={song}
                active={index === s.index}
                onPress={() => playerService.skipTo(index)}
                right={
                  <>
                    <IconButton
                      icon="x"
                      size={18}
                      label={t('audioStudio.queue.remove')}
                      onPress={() => playerService.removeAt(index)}
                    />
                    <DragHandle
                      label={t('audioStudio.queue.drag')}
                      onStart={() => {
                        dy.setValue(0);
                        setDragging(index);
                      }}
                      onMove={d => dy.setValue(d)}
                      onDrop={d => onDrop(index, d)}
                      onCancel={() => {
                        setDragging(null);
                        dy.setValue(0);
                      }}
                    />
                  </>
                }
              />
            </Animated.View>
          );
        })}
      </ScrollView>
      <NameDialog
        visible={saveOpen}
        title={t('audioStudio.queue.save')}
        onClose={() => setSaveOpen(false)}
        onSubmit={name =>
          collectionsService.createPlaylist(
            name,
            items.map(i => i.song.id),
          )
        }
      />
    </View>
  );
}

/**
 * A drag grip. Its PanResponder is created once (callbacks read through a
 * ref): a responder rebuilt on re-render would lose the gesture mid-drag.
 */
export function DragHandle(props: {
  label: string;
  onStart: () => void;
  onMove: (dy: number) => void;
  onDrop: (dy: number) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const cb = useRef(props);
  cb.current = props;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => cb.current.onStart(),
      onPanResponderMove: (_, g) => cb.current.onMove(g.dy),
      onPanResponderRelease: (_, g) => cb.current.onDrop(g.dy),
      onPanResponderTerminate: () => cb.current.onCancel(),
    }),
  ).current;
  return (
    <View
      {...responder.panHandlers}
      accessibilityLabel={props.label}
      style={styles.handle}
    >
      <Icon name="gripVertical" size={20} color={colors.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  spread: { justifyContent: 'space-between' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mini: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  miniProgress: { position: 'absolute', top: 0, left: 0, height: 2 },
  handle: { paddingHorizontal: 8, paddingVertical: 12 },
});
