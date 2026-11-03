import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
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
import type { IconName } from '@/shared/assets';
import {
  animateNextLayout,
  Button,
  EmptyState,
  Header,
  Icon,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { useClock } from '../../hooks/useLife';
import { fullBackup } from '../../services/fullBackup.service';
import { formatDay } from '../../utils/format';
import { Chips } from '../components/Chips';
import { MindMapCanvas, type CanvasHandle } from '../components/MindMapCanvas';
import type { NodeCardData } from '../components/NodeCard';
import {
  NodeDetailSheet,
  type NodeAction,
} from '../components/NodeDetailSheet';
import {
  NodeFormSheet,
  type NodeFormTarget,
} from '../components/NodeFormSheet';
import {
  MovePicker,
  NodeActionMenu,
  NodeSearch,
  type MenuAction,
} from '../components/NodeMenus';
import {
  plannerActions,
  useLabels,
  usePlannerData,
  usePlannerReminderSync,
  useProjectMap,
} from '../hooks/usePlanner';
import { TIMELINE_YEAR_PX } from '../services/layout';
import { MAP_STYLES, type LongTermNode, type MapStyle } from '../types';

const HIGHLIGHT_MS = 2500;

/**
 * A long-term project's interactive mind map: four layouts over the same
 * nodes, pan / pinch / zoom, tap to select, tap again for details, double
 * tap to collapse, long press for actions, drag a selected node, undo/redo,
 * search, focus mode. The camera position is saved per project.
 */
export default function PlannerMapScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MainStackParamList, 'PlannerMap'>>();
  const data = usePlannerData();
  const { today } = useClock();
  const labels = useLabels(data);
  usePlannerReminderSync(data);
  const project = data.projects.find(p => p.id === params.projectId);
  const style: MapStyle = project?.preferredStyle ?? 'tree';
  const [focusId, setFocusId] = useState<string | null>(null);
  const view = useProjectMap(data, params.projectId, style, focusId, today);
  const canvas = useRef<CanvasHandle>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [form, setForm] = useState<NodeFormTarget | null>(null);
  const [showStyles, setShowStyles] = useState(false);
  const [searching, setSearching] = useState(false);
  const [, rerender] = useState(0);

  // Search result / deep link: reveal, centre and highlight a node.
  const pendingFocus = useRef<string | null>(params.focusNodeId ?? null);
  const reveal = useCallback((id: string) => {
    plannerActions.revealNode(id);
    pendingFocus.current = id;
    setSelectedId(id);
    setHighlightId(id);
    setTimeout(() => setHighlightId(h => (h === id ? null : h)), HIGHLIGHT_MS);
  }, []);
  useEffect(() => {
    if (params.focusNodeId) reveal(params.focusNodeId);
  }, [params.focusNodeId, reveal]);
  useEffect(() => {
    const id = pendingFocus.current;
    if (id && view?.layout.boxes.has(id)) {
      pendingFocus.current = null;
      // After the canvas has laid out the revealed node.
      setTimeout(() => canvas.current?.centerOn(id, 0.9), 60);
    }
  }, [view?.layout]);

  const cards = useMemo(() => {
    const out = new Map<string, NodeCardData>();
    if (!view) return out;
    const kids = new Map<string, number>();
    for (const n of view.nodes)
      if (n.parentId) kids.set(n.parentId, (kids.get(n.parentId) ?? 0) + 1);
    for (const n of view.nodes) {
      const s = labels.status(n.statusId);
      const c = labels.category(n.categoryId);
      const p = view.progress.get(n.id);
      out.set(n.id, {
        id: n.id,
        name: n.name,
        icon: n.icon,
        imageUri: n.imageUri,
        color: labels.nodeColor(n),
        statusName: s.name,
        statusColor: s.color,
        statusKind: s.kind,
        categoryName: n.parentId ? c.name : '',
        categoryColor: c.color,
        milestone: n.kind === 'milestone',
        progress: p?.value ?? null,
        target:
          n.targetDate.slice(0, 4) === today.slice(0, 4)
            ? formatDay(n.targetDate)
            : n.targetDate.slice(0, 4),
        estimated: n.dateEstimated,
        childCount: kids.get(n.id) ?? 0,
        collapsed: n.collapsed,
        overdue: p?.isOverdue ?? false,
        root: n.parentId === null,
      });
    }
    return out;
  }, [view, labels, today]);

  if (!project || !view) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <Header label={t('planner.title')} />
        <EmptyState
          icon="triangleAlert"
          title={t('life.error_not_found')}
          testID="plan-missing"
        />
      </View>
    );
  }

  const node = (id: string | null) => (id ? view.byId.get(id) ?? null : null);
  const selected = node(selectedId);
  const hasChildren = (id: string) => view.nodes.some(n => n.parentId === id);

  const todayX = (() => {
    if (style !== 'timeline' || !view.layout.years.length) return null;
    const y = Number(today.slice(0, 4));
    const mark = view.layout.years.find(m => m.year === y);
    if (!mark) return null;
    const start = Date.UTC(y, 0, 1);
    const frac =
      (Date.parse(`${today}T00:00:00Z`) - start) /
      (Date.UTC(y + 1, 0, 1) - start);
    return mark.x + frac * TIMELINE_YEAR_PX;
  })();

  const toggle = (id: string) => {
    const n = node(id);
    if (!n || !hasChildren(id)) return;
    animateNextLayout();
    plannerActions.setCollapsed(id, !n.collapsed);
  };

  const confirmDelete = (n: LongTermNode) => {
    const count = plannerActions.branchSize(n.id);
    const done = () => {
      setDetailId(null);
      setSelectedId(null);
    };
    Alert.alert(
      t('planner.deleteTitle', { name: n.name }),
      count
        ? t('planner.deleteBranchBody', { count })
        : t('planner.deleteLeafBody'),
      [
        { text: t('life.cancel'), style: 'cancel' },
        ...(count
          ? [
              {
                text: t('planner.keepChildren'),
                onPress: () => {
                  plannerActions.deleteNode(n.id, 'reparent');
                  done();
                },
              },
            ]
          : []),
        {
          text: count
            ? t('planner.deleteBranch', { count: count + 1 })
            : t('planner.delete'),
          style: 'destructive' as const,
          onPress: () => {
            plannerActions.deleteNode(n.id, 'branch');
            done();
          },
        },
      ],
    );
  };

  const onMenu = (action: MenuAction, n: LongTermNode) => {
    setMenuId(null);
    const parent = n.parentId ? node(n.parentId) : null;
    switch (action) {
      case 'addChild':
        return setForm({ parent: n });
      case 'addSibling':
        return parent && setForm({ parent });
      case 'edit':
        return n.parentId === null
          ? navigation.navigate(ROUTES.PLANNER_PROJECT_FORM, {
              projectId: project.id,
            })
          : setForm({ node: n });
      case 'duplicate': {
        const r = plannerActions.duplicateNode(n.id, t('planner.copySuffix'));
        if (r.ok) setSelectedId(r.value.id);
        return;
      }
      case 'move':
        return setMoveId(n.id);
      case 'toggle':
        return toggle(n.id);
      case 'complete':
        return plannerActions.setNodeStatus(n.id, 'completed', today);
      case 'note':
        return setDetailId(n.id);
      case 'delete':
        return confirmDelete(n);
    }
  };

  const onDetailAction = (action: NodeAction, n: LongTermNode) => {
    switch (action) {
      case 'edit':
        setDetailId(null);
        return onMenu('edit', n);
      case 'addChild':
        setDetailId(null);
        return setForm({ parent: n });
      case 'addMilestone':
        setDetailId(null);
        return setForm({ parent: n, kind: 'milestone' });
      case 'focus':
        setDetailId(null);
        setFocusId(n.parentId ? n.id : null);
        return setTimeout(() => canvas.current?.centerOn(n.id), 60);
      case 'timeline':
        setDetailId(null);
        plannerActions.setPreferredStyle(project.id, 'timeline');
        return setTimeout(() => canvas.current?.centerOn(n.id, 0.7), 80);
      case 'delete':
        return confirmDelete(n);
    }
  };

  const setStyle = (s: MapStyle) => {
    animateNextLayout();
    plannerActions.setPreferredStyle(project.id, s);
    setShowStyles(false);
    setTimeout(() => canvas.current?.fit(), 80);
  };

  const exportMenu = () =>
    Alert.alert(t('planner.exportTitle'), t('planner.exportBody'), [
      { text: t('life.cancel'), style: 'cancel' },
      {
        text: t('planner.exportPlanner'),
        onPress: () => {
          fullBackup
            .exportPlannerJson()
            .catch(() => Alert.alert(t('life.backupError_export_failed')));
        },
      },
      {
        text: t('planner.exportFull'),
        onPress: () => {
          fullBackup
            .exportZip(true)
            .catch(() => Alert.alert(t('life.backupError_export_failed')));
        },
      },
    ]);

  const tools: {
    key: string;
    icon: IconName;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    active?: boolean;
  }[] = [
    {
      key: 'add',
      icon: 'plus',
      label: t('planner.addNode'),
      onPress: () => setForm({ parent: selected ?? node(project.rootNodeId)! }),
    },
    {
      key: 'zoom-in',
      icon: 'plus',
      label: t('planner.zoomIn'),
      onPress: () => canvas.current?.zoomBy(1.3),
    },
    {
      key: 'zoom-out',
      icon: 'arrowDown',
      label: t('planner.zoomOut'),
      onPress: () => canvas.current?.zoomBy(1 / 1.3),
    },
    {
      key: 'fit',
      icon: 'scanLine',
      label: t('planner.fit'),
      onPress: () => canvas.current?.fit(),
    },
    {
      key: 'root',
      icon: 'crosshair',
      label: t('planner.centerRoot'),
      onPress: () => canvas.current?.centerOn(project.rootNodeId),
    },
    {
      key: 'undo',
      icon: 'rotateCcw',
      label: t('planner.undo'),
      disabled: !plannerActions.canUndo(project.id),
      onPress: () => {
        plannerActions.undo(project.id);
        rerender(x => x + 1);
      },
    },
    {
      key: 'redo',
      icon: 'rotateCw',
      label: t('planner.redo'),
      disabled: !plannerActions.canRedo(project.id),
      onPress: () => {
        plannerActions.redo(project.id);
        rerender(x => x + 1);
      },
    },
    {
      key: 'style',
      icon: 'layers',
      label: t('planner.mapStyle'),
      active: showStyles,
      onPress: () => setShowStyles(s => !s),
    },
    {
      key: 'search',
      icon: 'search',
      label: t('planner.search'),
      onPress: () => setSearching(true),
    },
    {
      key: 'expand',
      icon: 'arrowDown',
      label: t('planner.expandAll'),
      onPress: () => {
        animateNextLayout();
        plannerActions.setAllCollapsed(project.id, false);
      },
    },
    {
      key: 'collapse',
      icon: 'arrowUp',
      label: t('planner.collapseAll'),
      onPress: () => {
        animateNextLayout();
        plannerActions.setAllCollapsed(project.id, true);
      },
    },
    {
      key: 'focus',
      icon: 'eye',
      label: focusId ? t('planner.showAll') : t('planner.focusMode'),
      active: !!focusId,
      disabled: !focusId && (!selected || !selected.parentId),
      onPress: () => setFocusId(f => (f ? null : selected?.id ?? null)),
    },
    {
      key: 'export',
      icon: 'upload',
      label: t('planner.export'),
      onPress: exportMenu,
    },
  ];

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={project.name} />
      <View style={[styles.toolbar, { borderBottomColor: colors.divider }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: spacing.sm,
            gap: spacing.xs,
          }}
        >
          {tools.map(tool => (
            <Pressable
              key={tool.key}
              onPress={tool.onPress}
              disabled={tool.disabled}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              accessibilityState={{
                disabled: !!tool.disabled,
                selected: !!tool.active,
              }}
              style={({ pressed }) => [
                styles.tool,
                {
                  borderRadius: radius.md,
                  backgroundColor: tool.active
                    ? colors.primarySoft
                    : pressed
                    ? colors.surfaceMuted
                    : 'transparent',
                  opacity: tool.disabled ? 0.35 : 1,
                },
              ]}
              testID={`map-tool-${tool.key}`}
            >
              <Icon name={tool.icon} size={20} color={colors.textPrimary} />
              <Text
                style={[
                  typography.overline,
                  styles.toolLabel,
                  { color: colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {tool.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {showStyles ? (
        <View style={{ padding: spacing.sm }}>
          <Chips
            options={MAP_STYLES.map(s => ({
              value: s,
              label: t(`planner.style_${s}`),
            }))}
            value={style}
            onChange={s => setStyle(s as MapStyle)}
            accessibilityLabel={t('planner.mapStyle')}
            testID="map-style"
          />
        </View>
      ) : null}
      {focusId ? (
        <Pressable
          onPress={() => setFocusId(null)}
          style={[
            styles.banner,
            { backgroundColor: colors.primarySoft, padding: spacing.sm },
          ]}
          accessibilityRole="button"
          testID="focus-banner"
        >
          <Text style={[typography.caption, { color: colors.textPrimary }]}>
            {t('planner.focusedOn', { name: node(focusId)?.name ?? '' })}
          </Text>
        </Pressable>
      ) : null}

      <MindMapCanvas
        ref={canvas}
        layout={view.layout}
        cards={cards}
        selectedId={selectedId}
        highlightId={highlightId}
        initialView={data.settings.views[project.id] ?? null}
        todayX={todayX}
        onViewChange={v => plannerActions.saveView(project.id, v)}
        onTap={id => {
          if (id === selectedId) setDetailId(id);
          else setSelectedId(id);
        }}
        onDoubleTap={toggle}
        onLongPress={id => {
          setSelectedId(id);
          setMenuId(id);
        }}
        onBackgroundTap={() => setSelectedId(null)}
        onDragEnd={(id, dx, dy) => {
          const n = node(id);
          if (!n || (Math.abs(dx) < 2 && Math.abs(dy) < 2)) return;
          const o = n.offsets[style] ?? { x: 0, y: 0 };
          plannerActions.setOffset(id, style, { x: o.x + dx, y: o.y + dy });
        }}
      />

      {selected ? (
        <View
          style={[
            styles.selection,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: radius.lg,
              padding: spacing.sm,
              gap: spacing.sm,
              bottom: bottom + spacing.md,
              marginHorizontal: spacing.md,
            },
          ]}
          testID="selection-bar"
        >
          <View style={styles.flex}>
            <Text
              style={[typography.label, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {selected.name}
            </Text>
            <Text
              style={[typography.caption, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {labels.status(selected.statusId).name}
              {view.progress.get(selected.id)?.value !== null &&
              view.progress.get(selected.id)
                ? ` · ${Math.round(view.progress.get(selected.id)!.value!)}%`
                : ''}
              {` · ${t('planner.dragHint')}`}
            </Text>
          </View>
          <Button
            size="sm"
            variant="soft"
            label={t('planner.details')}
            onPress={() => setDetailId(selected.id)}
            testID="selection-details"
          />
          <Button
            size="sm"
            label={t('planner.addChildShort')}
            iconName="plus"
            onPress={() => setForm({ parent: selected })}
            testID="selection-add"
          />
        </View>
      ) : null}

      <NodeDetailSheet
        node={node(detailId)}
        progress={detailId ? view.progress.get(detailId) : undefined}
        today={today}
        onClose={() => setDetailId(null)}
        onSelect={id => {
          setDetailId(null);
          reveal(id);
        }}
        onAction={onDetailAction}
      />
      <NodeActionMenu
        node={node(menuId)}
        hasChildren={menuId ? hasChildren(menuId) : false}
        onClose={() => setMenuId(null)}
        onAction={onMenu}
      />
      <MovePicker
        node={node(moveId)}
        nodes={view.nodes}
        onClose={() => setMoveId(null)}
        onPick={parentId => {
          const id = moveId!;
          setMoveId(null);
          const r = plannerActions.moveNode(id, parentId);
          if (!r.ok) Alert.alert(t(`planner.error_${r.error}`));
          else reveal(id);
        }}
      />
      <NodeFormSheet
        target={form}
        today={today}
        onClose={() => setForm(null)}
        onSaved={n => {
          setForm(null);
          reveal(n.id);
        }}
      />
      <NodeSearch
        visible={searching}
        data={data}
        projectId={project.id}
        onClose={() => setSearching(false)}
        onPick={hit => {
          setSearching(false);
          setFocusId(null);
          reveal(hit.node.id);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  toolbar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 4 },
  tool: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
    minHeight: 52,
    paddingHorizontal: 6,
  },
  toolLabel: { textTransform: 'none', letterSpacing: 0, marginTop: 2 },
  banner: { alignItems: 'center' },
  selection: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
