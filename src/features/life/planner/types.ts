/**
 * Long-Term Planner data model (Manage Life → Long-Term Planner).
 *
 * A plan is a tree: every project has exactly one root node (its own card on
 * the map, kept in sync with the project's name/dates) and any number of
 * nested descendants linked by `parentId`. Milestones are nodes with
 * `kind: 'milestone'`, so they appear on every map style, the timeline and
 * the milestone lists without a second record to keep in step.
 *
 * Days are `DayKey`s ("YYYY-MM-DD", any year — plans may span decades);
 * instants are ISO strings.
 */
import type { DayKey } from '@/shared/utils/dayKey';

export type { DayKey };

export const MAP_STYLES = ['tree', 'roadmap', 'radial', 'timeline'] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

export type PlanStatus = 'active' | 'completed' | 'archived';
export type Priority = 'high' | 'medium' | 'low';

/** How a parent combines its children (see services/plannerProgress.ts). */
export type ProgressModel = 'equal' | 'weighted';
/** Whether optional-category children count towards their parent. */
export type OptionalMode = 'count' | 'exclude';

export interface DeadlineChange {
  /** Target date before the change. */
  from: DayKey;
  to: DayKey;
  at: string;
}

export interface LongTermProject {
  id: string;
  name: string;
  description: string;
  vision: string;
  successCriteria: string;
  category: string;
  priority: Priority;
  icon: string;
  imageUri: string;
  coverUri: string;
  color: string;
  startDate: DayKey;
  targetDate: DayKey;
  /** The target date is an estimate, not a commitment. */
  targetEstimated: boolean;
  /** Earlier target dates, oldest first — editing never loses them. */
  deadlineHistory: DeadlineChange[];
  status: PlanStatus;
  preferredStyle: MapStyle;
  progressModel: ProgressModel;
  optionalMode: OptionalMode;
  /** Id of the project's root node. */
  rootNodeId: string;
  createdAt: string;
  updatedAt: string;
}

export type NodeKind = 'node' | 'milestone';

/** Offset a user dragged a node (and its branch) by, per map style. */
export type NodeOffsets = Partial<Record<MapStyle, { x: number; y: number }>>;

export interface Attachment {
  uri: string;
  name: string;
  mime: string;
}

/** A stable reference to a Manage Life project or task (never a copy). */
export interface NodeLink {
  type: 'project' | 'task';
  id: string;
}

export interface LongTermNode {
  id: string;
  projectId: string;
  /** null only for the project's root node. */
  parentId: string | null;
  kind: NodeKind;
  name: string;
  description: string;
  icon: string;
  imageUri: string;
  /** '' = use the status colour. */
  color: string;
  statusId: string;
  categoryId: string;
  startDate: DayKey;
  targetDate: DayKey;
  /** The target date is an estimate. */
  dateEstimated: boolean;
  /** The user confirmed dates outside the parent's range on purpose. */
  rangeConfirmed: boolean;
  actualCompletedAt: DayKey | null;
  /** 0–100, used by running / custom-status leaves. */
  progress: number;
  /** Relative weight in the parent's weighted model (default 1). */
  weight: number;
  priority: Priority;
  /** Free text, e.g. "3 months", "200 h". */
  effort: string;
  notes: string;
  sortOrder: number;
  collapsed: boolean;
  offsets: NodeOffsets;
  link: NodeLink | null;
  attachments: Attachment[];
  /** Local date-time "YYYY-MM-DDTHH:mm" for a reminder, or null. */
  reminderAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What a status means for progress. */
export type StatusKind =
  | 'pending'
  | 'running'
  | 'completed'
  | 'ignored'
  | 'other';

export interface LongTermStatus {
  id: string;
  name: string;
  color: string;
  kind: StatusKind;
  isSystem: boolean;
  isActive: boolean;
}

export interface LongTermCategory {
  id: string;
  name: string;
  color: string;
  /** 'mandatory' | 'optional' for the built-ins; 'other' for custom ones. */
  kind: 'mandatory' | 'optional' | 'other';
  isSystem: boolean;
  isActive: boolean;
}

export interface LongTermNote {
  id: string;
  nodeId: string;
  content: string;
  /** A plain note, or a progress update that also recorded a percent. */
  type: 'note' | 'progress';
  progress: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-project canvas view (restored when the map reopens). */
export interface PlannerView {
  scale: number;
  x: number;
  y: number;
}

export interface PlannerSettings {
  views: Record<string, PlannerView>;
}

export interface PlannerData {
  version: number;
  projects: LongTermProject[];
  nodes: LongTermNode[];
  statuses: LongTermStatus[];
  categories: LongTermCategory[];
  notes: LongTermNote[];
  settings: PlannerSettings;
}

export const SYSTEM_STATUS_IDS = [
  'pending',
  'running',
  'completed',
  'ignored',
] as const;
export const SYSTEM_CATEGORY_IDS = ['mandatory', 'optional'] as const;
