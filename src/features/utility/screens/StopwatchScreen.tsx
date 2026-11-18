import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sheet } from '@/features/followup';
import { FormField } from '@/features/life';
import {
  Button,
  EmptyState,
  Header,
  Icon,
  StatusPill,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { useStopwatches, type StopwatchView } from '../hooks/useClock';
import { formatClock, MAX_LAPS } from '../services/clock';
import { MAX_STOPWATCHES } from '../store/clock.store';

/** Laps shown before "Show all". */
const LAPS_SHOWN = 3;

/**
 * Multiple Stopwatch: up to 20 named, independent stopwatches with laps.
 * Each stores when it started, so all keep counting while the app is in
 * the background or closed; nothing ticks unless this screen is open.
 */
export default function StopwatchScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const sw = useStopwatches();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<StopwatchView | null>(null);
  const [newName, setNewName] = useState('');
  const full = sw.items.length >= MAX_STOPWATCHES;

  const confirmDelete = (s: StopwatchView) =>
    Alert.alert(t('utility.deleteNamedTitle', { name: s.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('utility.delete'),
        style: 'destructive',
        onPress: () => sw.remove(s.id),
      },
    ]);

  const toggleLaps = (id: string) =>
    setExpanded(cur => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderItem = ({ item: s }: { item: StopwatchView }) => {
    const started = s.running || s.elapsed > 0;
    const open = expanded.has(s.id);
    const laps = open ? s.lapList : s.lapList.slice(0, LAPS_SHOWN);
    return (
      <View
        testID={`stopwatch-${s.id}`}
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: s.running ? colors.primary : colors.border,
            borderRadius: radius.lg,
            padding: spacing.md,
            gap: spacing.sm,
          },
        ]}
      >
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Pressable
            onPress={() => {
              setRenaming(s);
              setNewName(s.name);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('utility.renameNamed', { name: s.name })}
            style={[styles.row, styles.flex, { gap: spacing.xs }]}
            testID={`stopwatch-rename-${s.id}`}
          >
            <Text
              style={[
                typography.label,
                styles.shrink,
                { color: colors.textPrimary },
              ]}
              numberOfLines={1}
            >
              {s.name}
            </Text>
            <Icon name="pencil" size={14} color={colors.textSecondary} />
          </Pressable>
          <StatusPill
            label={t(
              s.running
                ? 'utility.stateRunning'
                : started
                ? 'utility.statePaused'
                : 'utility.stateReady',
            )}
            tone={s.running ? 'success' : started ? 'warning' : 'neutral'}
          />
          <Pressable
            onPress={() => confirmDelete(s)}
            accessibilityRole="button"
            accessibilityLabel={t('utility.deleteNamed', { name: s.name })}
            hitSlop={8}
            testID={`stopwatch-delete-${s.id}`}
          >
            <Icon name="trash2" size={18} color={colors.error} />
          </Pressable>
        </View>
        <Text
          testID={`stopwatch-time-${s.id}`}
          accessibilityRole="timer"
          style={[
            typography.display,
            styles.time,
            { color: colors.textPrimary },
          ]}
        >
          {formatClock(s.elapsed, true)}
        </Text>
        <View style={[styles.row, { gap: spacing.sm }]}>
          {s.running ? (
            <Button
              size="sm"
              variant="secondary"
              iconName="plus"
              label={t('utility.lap')}
              onPress={() => sw.lap(s.id)}
              disabled={s.laps.length >= MAX_LAPS}
              style={styles.flex}
              testID={`stopwatch-lap-${s.id}`}
            />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              iconName="rotateCcw"
              label={t('utility.reset')}
              onPress={() => sw.reset(s.id)}
              disabled={!started}
              style={styles.flex}
              testID={`stopwatch-reset-${s.id}`}
            />
          )}
          {s.running ? (
            <Button
              size="sm"
              variant="danger"
              iconName="pause"
              label={t('utility.pause')}
              onPress={() => sw.pause(s.id)}
              style={styles.flex}
              testID={`stopwatch-pause-${s.id}`}
            />
          ) : (
            <Button
              size="sm"
              iconName="play"
              label={started ? t('utility.resume') : t('utility.start')}
              onPress={() => sw.start(s.id)}
              style={styles.flex}
              testID={`stopwatch-start-${s.id}`}
            />
          )}
        </View>
        {laps.map(l => (
          <View
            key={l.index}
            testID={`lap-${s.id}-${l.index}`}
            accessible
            accessibilityLabel={t('utility.lapA11y', {
              n: l.index,
              split: formatClock(l.splitMs, true),
              total: formatClock(l.totalMs, true),
            })}
            style={[
              styles.row,
              styles.lap,
              {
                borderTopColor: colors.divider,
                paddingTop: spacing.xs,
                gap: spacing.md,
              },
            ]}
          >
            <Text
              style={[
                typography.caption,
                styles.lapNo,
                { color: colors.textSecondary },
              ]}
            >
              {t('utility.lapN', { n: l.index })}
            </Text>
            <Text
              style={[
                typography.body,
                styles.flex,
                {
                  color: l.fastest
                    ? colors.success
                    : l.slowest
                    ? colors.error
                    : colors.textPrimary,
                },
              ]}
            >
              {formatClock(l.splitMs, true)}
              {l.fastest ? ` · ${t('utility.fastest')}` : ''}
              {l.slowest ? ` · ${t('utility.slowest')}` : ''}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {formatClock(l.totalMs, true)}
            </Text>
          </View>
        ))}
        {s.lapList.length > LAPS_SHOWN ? (
          <Button
            size="sm"
            variant="ghost"
            label={
              open
                ? t('utility.lapsLess')
                : t('utility.lapsAll', { count: s.lapList.length })
            }
            onPress={() => toggleLaps(s.id)}
            testID={`stopwatch-laps-${s.id}`}
          />
        ) : null}
      </View>
    );
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_stopwatch')} />
      <FlatList
        data={sw.items}
        keyExtractor={s => s.id}
        renderItem={renderItem}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
        ListHeaderComponent={
          <View style={{ gap: spacing.sm }}>
            <Button
              iconName="plus"
              label={t('utility.addStopwatch')}
              onPress={() =>
                sw.add(t('utility.stopwatchN', { n: sw.items.length + 1 }))
              }
              disabled={full}
              testID="stopwatch-add"
            />
            {full ? (
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t('utility.limitReached', { count: MAX_STOPWATCHES })}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="clock"
            title={t('utility.stopwatchEmptyTitle')}
            message={t('utility.stopwatchEmptyBody')}
            testID="stopwatch-empty"
          />
        }
      />
      <Sheet
        visible={renaming !== null}
        title={t('utility.rename')}
        onClose={() => setRenaming(null)}
        testID="stopwatch-rename-sheet"
        footer={
          <Button
            label={t('utility.save')}
            onPress={() => {
              if (renaming) sw.rename(renaming.id, newName);
              setRenaming(null);
            }}
            testID="stopwatch-rename-save"
          />
        }
      >
        <FormField
          label={t('utility.name')}
          value={newName}
          onChangeText={setNewName}
          maxLength={40}
          testID="stopwatch-rename-field"
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  time: { fontVariant: ['tabular-nums'] },
  lap: { borderTopWidth: StyleSheet.hairlineWidth },
  lapNo: { minWidth: 56 },
});
