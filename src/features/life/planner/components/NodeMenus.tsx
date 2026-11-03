import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/shared/components';
import type { IconName } from '@/shared/assets';
import { useTheme } from '@/theme';
import { ancestorIds, indexById } from '../services/hierarchy';
import {
  moveTargets,
  searchNodes,
  type SearchHit,
} from '../services/plannerQueries';
import type { LongTermNode, PlannerData } from '../types';

export type MenuAction =
  | 'addChild'
  | 'addSibling'
  | 'edit'
  | 'duplicate'
  | 'move'
  | 'toggle'
  | 'complete'
  | 'note'
  | 'delete';

function Sheet({
  visible,
  title,
  onClose,
  children,
  testID,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testID: string;
}) {
  const { t } = useTranslation();
  const { bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        <Pressable style={styles.flex} onPress={onClose} accessible={false} />
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
          testID={testID}
        >
          <View
            style={[
              styles.row,
              { padding: spacing.lg, paddingBottom: spacing.sm },
            ]}
          >
            <Text
              style={[
                typography.title,
                styles.flex,
                { color: colors.textPrimary },
              ]}
              numberOfLines={1}
              accessibilityRole="header"
            >
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              style={styles.close}
            >
              <Icon name="x" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** Long-press menu for one node. */
export function NodeActionMenu({
  node,
  hasChildren,
  onClose,
  onAction,
}: {
  node: LongTermNode | null;
  hasChildren: boolean;
  onClose: () => void;
  onAction: (action: MenuAction, node: LongTermNode) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  if (!node) return null;
  const root = node.parentId === null;
  const items: {
    key: MenuAction;
    icon: IconName;
    label: string;
    danger?: boolean;
  }[] = [
    { key: 'addChild', icon: 'plus', label: t('planner.addChild') },
    ...(root
      ? []
      : [
          {
            key: 'addSibling' as const,
            icon: 'layers' as const,
            label: t('planner.addSibling'),
          },
        ]),
    { key: 'edit', icon: 'pencil', label: t('planner.edit') },
    ...(root
      ? []
      : [
          {
            key: 'duplicate' as const,
            icon: 'copy' as const,
            label: t('planner.duplicate'),
          },
        ]),
    ...(root
      ? []
      : [
          {
            key: 'move' as const,
            icon: 'move' as const,
            label: t('planner.moveTo'),
          },
        ]),
    ...(hasChildren
      ? [
          {
            key: 'toggle' as const,
            icon: (node.collapsed ? 'arrowDown' : 'arrowUp') as IconName,
            label: node.collapsed ? t('planner.expand') : t('planner.collapse'),
          },
        ]
      : []),
    { key: 'complete', icon: 'circleCheck', label: t('planner.markCompleted') },
    { key: 'note', icon: 'stickyNote', label: t('planner.addNote') },
    ...(root
      ? []
      : [
          {
            key: 'delete' as const,
            icon: 'x' as const,
            label: t('planner.delete'),
            danger: true,
          },
        ]),
  ];
  return (
    <Sheet visible title={node.name} onClose={onClose} testID="node-menu">
      <View style={{ paddingHorizontal: spacing.md }}>
        {items.map(item => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            onPress={() => onAction(item.key, node)}
            style={({ pressed }) => [
              styles.item,
              {
                gap: spacing.md,
                paddingHorizontal: spacing.md,
                backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
              },
            ]}
            testID={`node-menu-${item.key}`}
          >
            <Icon
              name={item.icon}
              size={20}
              color={item.danger ? colors.error : colors.textPrimary}
            />
            <Text
              style={[
                typography.body,
                { color: item.danger ? colors.error : colors.textPrimary },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

/** Pick a new parent: only nodes that can't create a cycle are listed. */
export function MovePicker({
  node,
  nodes,
  onClose,
  onPick,
}: {
  node: LongTermNode | null;
  nodes: readonly LongTermNode[];
  onClose: () => void;
  onPick: (parentId: string) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [query, setQuery] = useState('');
  const targets = useMemo(() => {
    if (!node) return [];
    const byId = indexById(nodes);
    const q = query.trim().toLowerCase();
    return moveTargets(nodes, node.id)
      .filter(n => !q || n.name.toLowerCase().includes(q))
      .map(n => ({
        node: n,
        path: ancestorIds(byId, n.id)
          .reverse()
          .map(id => byId.get(id)?.name ?? '')
          .join(' › '),
      }));
  }, [node, nodes, query]);
  if (!node) return null;
  return (
    <Sheet
      visible
      title={t('planner.moveTitle', { name: node.name })}
      onClose={onClose}
      testID="move-picker"
    >
      <View
        style={[
          styles.shrink,
          { paddingHorizontal: spacing.lg, gap: spacing.sm },
        ]}
      >
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('planner.searchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          style={[
            typography.body,
            styles.input,
            {
              color: colors.textPrimary,
              borderColor: colors.border,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
            },
          ]}
          accessibilityLabel={t('planner.searchPlaceholder')}
          testID="move-search"
        />
        <FlatList
          data={targets}
          keyExtractor={x => x.node.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('planner.noMoveTargets')}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPick(item.node.id)}
              style={[styles.result, { paddingVertical: spacing.sm }]}
              testID={`move-to-${item.node.id}`}
            >
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {item.node.name}
              </Text>
              {item.path ? (
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {item.path}
                </Text>
              ) : null}
            </Pressable>
          )}
        />
      </View>
    </Sheet>
  );
}

/** Search nodes (names and descriptions) in one project or all. */
export function NodeSearch({
  visible,
  data,
  projectId,
  onClose,
  onPick,
}: {
  visible: boolean;
  data: PlannerData;
  projectId?: string;
  onClose: () => void;
  onPick: (hit: SearchHit) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [query, setQuery] = useState('');
  const hits = useMemo(
    () =>
      searchNodes(data, query, 80).filter(
        h => !projectId || h.project.id === projectId,
      ),
    [data, query, projectId],
  );
  return (
    <Sheet
      visible={visible}
      title={t('planner.searchTitle')}
      onClose={onClose}
      testID="node-search"
    >
      <View
        style={[
          styles.shrink,
          { paddingHorizontal: spacing.lg, gap: spacing.sm },
        ]}
      >
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          placeholder={t('planner.searchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          style={[
            typography.body,
            styles.input,
            {
              color: colors.textPrimary,
              borderColor: colors.border,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
            },
          ]}
          accessibilityLabel={t('planner.searchPlaceholder')}
          testID="node-search-input"
        />
        <FlatList
          data={hits}
          keyExtractor={h => h.node.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            query.trim() ? (
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t('planner.noResults')}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPick(item)}
              style={[styles.result, { paddingVertical: spacing.sm }]}
              testID={`search-hit-${item.node.id}`}
            >
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {item.node.name}
              </Text>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {[projectId ? null : item.project.name, ...item.path]
                  .filter(Boolean)
                  .join(' › ')}
              </Text>
            </Pressable>
          )}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '80%' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  input: { borderWidth: 1, minHeight: 44 },
  result: { gap: 2 },
  shrink: { flexShrink: 1 },
});
