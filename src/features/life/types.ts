/**
 * Manage Life data model.
 *
 * Dates that mean "a calendar day" are `DayKey`s ("YYYY-MM-DD", the user's
 * local calendar) so periods never shift with timezone or daylight-saving
 * changes; instants (report time, edits) are ISO strings.
 */
export type DayKey = string;

export type Priority = 'high' | 'medium' | 'low';
export type ProjectStatus = 'active' | 'completed' | 'archived';
export type TaskStatus = 'active' | 'paused' | 'completed' | 'archived';

/**
 * - daily: every calendar day.
 * - weekly: Monday–Sunday weeks.
 * - interval: every `intervalDays` days counted from the target's
 *   `effectiveFrom` ("every N days" and "custom interval" in the UI).
 */
export type FrequencyType = 'daily' | 'weekly' | 'interval';

/** One target definition. Edits add a version; old periods keep theirs. */
export interface TargetVersion {
  /** First day this version applies (always a period boundary). */
  effectiveFrom: DayKey;
  quantity: number;
  frequency: FrequencyType;
  /** Days per period for `interval`; 1 for daily, 7 for weekly. */
  intervalDays: number;
}

export interface Pause {
  from: DayKey;
  /** Inclusive; null while still paused. */
  to: DayKey | null;
  reason: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  objective: string;
  successCriteria: string;
  category: string;
  priority: Priority;
  notes: string;
  /** Built-in icon name, used when there is no picture. */
  icon: string;
  /** A picture copied into app storage, or ''. */
  imageUri: string;
  /** Key into the theme's category palette. */
  color: string;
  startDate: DayKey;
  deadline: DayKey;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  description: string;
  icon: string;
  imageUri: string;
  color: string;
  unit: string;
  /** Ordered by effectiveFrom; never empty. */
  targets: TargetVersion[];
  startDate: DayKey;
  endDate: DayKey | null;
  priority: Priority;
  status: TaskStatus;
  /** Marked as a focus task for today. */
  focusDay: DayKey | null;
  pauses: Pause[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportEdit {
  at: string;
  quantity: number;
  note: string;
}

/** One "Log progress" entry. Several can count towards one period. */
export interface ProgressReport {
  id: string;
  taskId: string;
  /** Calendar day the progress belongs to (decides its period). */
  day: DayKey;
  quantity: number;
  note: string;
  reportedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Previous values, newest last. */
  edits: ReportEdit[];
}

export type IncompleteReason =
  | 'procrastination'
  | 'unexpected_tasks'
  | 'commitments'
  | 'unrealistic'
  | 'low_energy'
  | 'distraction'
  | 'external'
  | 'other';

export const INCOMPLETE_REASONS: readonly IncompleteReason[] = [
  'procrastination',
  'unexpected_tasks',
  'commitments',
  'unrealistic',
  'low_energy',
  'distraction',
  'external',
  'other',
];

/** The period-end report for a target that was not achieved. One per task + period. */
export interface PeriodReview {
  id: string;
  taskId: string;
  periodStart: DayKey;
  periodEnd: DayKey;
  /** Snapshot at review time. */
  targetQuantity: number;
  completedQuantity: number;
  reason: IncompleteReason;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Recommendation {
  category:
    | 'summary'
    | 'blocker'
    | 'realism'
    | 'improvement'
    | 'adjustment'
    | 'next_step'
    | 'project'
    | 'positive';
  title: string;
  explanation: string;
  evidence: string;
  action: string;
  priority: Priority;
  /** Matched to one of the user's tasks, when the advice is about one. */
  taskId: string | null;
  proposedTarget: {
    quantity: number;
    frequency: FrequencyType;
    intervalDays: number;
  } | null;
}

export interface RecommendationSet {
  generatedAt: string;
  /** `LifeData.version` the recommendations were made from. */
  dataVersion: number;
  summary: string;
  items: Recommendation[];
}

export interface LifeData {
  schemaVersion: number;
  /** Increments on every change (lets cached AI advice show as stale). */
  version: number;
  projects: Project[];
  tasks: Task[];
  reports: ProgressReport[];
  reviews: PeriodReview[];
  recommendations: RecommendationSet | null;
}
