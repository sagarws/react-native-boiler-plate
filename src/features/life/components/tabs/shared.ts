import type { PeriodState } from '../../services/periods';
import type { DayKey, LifeData, Task } from '../../types';

export type LifeTab =
  | 'dashboard'
  | 'projects'
  | 'today'
  | 'calendar'
  | 'history'
  | 'insights';

export const LIFE_TABS: readonly LifeTab[] = [
  'dashboard',
  'projects',
  'today',
  'calendar',
  'history',
  'insights',
];

/** What every Manage Life tab receives from the screen. */
export interface TabProps {
  data: LifeData;
  today: DayKey;
  now: Date;
  onLog: (task: Task) => void;
  onReview: (item: PeriodState & { task: Task }) => void;
  onOpenProject: (projectId: string) => void;
  onNewProject: () => void;
  onTab: (tab: LifeTab) => void;
}
