import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { categoryColor } from '@/theme';
import { childrenMap } from '../services/hierarchy';
import { computeLayout, type Layout } from '../services/layout';
import {
  lookups,
  projectNodeProgress,
  type NodeProgress,
} from '../services/plannerProgress';
import {
  plannerReminders,
  syncPlannerReminders,
} from '../services/plannerReminders';
import { plannerStore } from '../store/planner.store';
import type {
  DayKey,
  LongTermCategory,
  LongTermNode,
  LongTermProject,
  LongTermStatus,
  MapStyle,
  PlannerData,
} from '../types';

/** All planner records, re-rendering on every change. */
export function usePlannerData(): PlannerData {
  return useSyncExternalStore(plannerStore.subscribe, plannerStore.read);
}

/** Store mutations for screens (the hook layer between UI and persistence). */
export const plannerActions = plannerStore;

/** Display name + palette colour of statuses and categories. */
export function useLabels(data: PlannerData) {
  const { t } = useTranslation();
  return useMemo(() => {
    const status = new Map(data.statuses.map(s => [s.id, s]));
    const category = new Map(data.categories.map(c => [c.id, c]));
    const statusName = (s: LongTermStatus | undefined) =>
      !s ? '' : s.isSystem ? t(`planner.status_${s.id}`) : s.name;
    const categoryName = (c: LongTermCategory | undefined) =>
      !c ? '' : c.isSystem ? t(`planner.category_${c.id}`) : c.name;
    return {
      status: (id: string) => {
        const s = status.get(id);
        return {
          name: statusName(s),
          color: categoryColor(s?.color ?? 'slate'),
          kind: s?.kind ?? 'pending',
        };
      },
      category: (id: string) => {
        const c = category.get(id);
        return {
          name: categoryName(c),
          color: categoryColor(c?.color ?? 'slate'),
          kind: c?.kind ?? 'other',
        };
      },
      /** A node's own colour, else its status colour. */
      nodeColor: (n: LongTermNode) =>
        n.color
          ? categoryColor(n.color)
          : categoryColor(status.get(n.statusId)?.color ?? 'slate'),
    };
  }, [data.statuses, data.categories, t]);
}

export interface ProjectView {
  project: LongTermProject;
  nodes: LongTermNode[];
  byId: Map<string, LongTermNode>;
  progress: Map<string, NodeProgress>;
  layout: Layout;
}

/**
 * One project's nodes, progress and layout. Recomputed only when the data
 * version, style or focus changes — never while panning or zooming.
 */
export function useProjectMap(
  data: PlannerData,
  projectId: string,
  style: MapStyle,
  focusId: string | null,
  today: DayKey,
): ProjectView | null {
  return useMemo(() => {
    const project = data.projects.find(p => p.id === projectId);
    if (!project) return null;
    const nodes = data.nodes.filter(n => n.projectId === projectId);
    const map = childrenMap(nodes);
    return {
      project,
      nodes,
      byId: new Map(nodes.map(n => [n.id, n])),
      progress: projectNodeProgress(
        project,
        nodes,
        lookups(data.statuses, data.categories),
        today,
        map,
      ),
      layout: computeLayout(nodes, project.rootNodeId, style, { focusId }),
    };
    // data.version covers every record change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.version, projectId, style, focusId, today]);
}

/**
 * Keeps the scheduled planner reminders equal to the stored ones: re-syncs
 * (debounced) whenever planner data changes — edits, deletes, restores.
 */
export function usePlannerReminderSync(data: PlannerData) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(() => {
      const list = plannerReminders(
        data,
        Date.now(),
        (name, project, target) => ({
          title: t('planner.reminderTitle', { name }),
          body: t('planner.reminderBody', { project, target }),
        }),
      );
      syncPlannerReminders(list);
    }, 800);
    return () => clearTimeout(timer);
    // data.version covers every record change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.version, t]);
}
