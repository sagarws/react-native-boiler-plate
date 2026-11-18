import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DayShadeInfo } from '../components/MonthCalendar';
import type { EvaluateInput } from '../services/periods';
import {
  initialHidden,
  projectDayCell,
  taskDayCell,
  toggleLine,
  type ProgressLevel,
  type ProjectDayCell,
  type TaskDayCell,
} from '../services/progress';
import type { DayKey, Task } from '../types';
import { addDays, daysInMonth, monthStart } from '../utils/dates';

const monthDays = (month: DayKey): DayKey[] => {
  const first = monthStart(month);
  return Array.from({ length: daysInMonth(first) }, (_, i) =>
    addDays(first, i),
  );
};

/** The task calendar's cells for the month containing [month]. */
export function useTaskMonth(
  task: Task,
  input: EvaluateInput,
  month: DayKey,
): Record<DayKey, TaskDayCell> {
  const { reports, reviews, today } = input;
  return useMemo(() => {
    const inp = { reports, reviews, today };
    const out: Record<DayKey, TaskDayCell> = {};
    for (const d of monthDays(month)) out[d] = taskDayCell(task, d, inp);
    return out;
  }, [task, reports, reviews, today, month]);
}

/** The project calendar's cells for the month containing [month]. */
export function useProjectMonth(
  tasks: readonly Task[],
  input: EvaluateInput,
  month: DayKey,
): Record<DayKey, ProjectDayCell> {
  const { reports, reviews, today } = input;
  return useMemo(() => {
    const inp = { reports, reviews, today };
    const out: Record<DayKey, ProjectDayCell> = {};
    for (const d of monthDays(month)) out[d] = projectDayCell(tasks, d, inp);
    return out;
  }, [tasks, reports, reviews, today, month]);
}

/** Calendar cells → the shading the calendar draws (label + spoken text). */
export function useShades(
  cells: Record<DayKey, { level: ProgressLevel; percent: number | null }>,
): Record<DayKey, DayShadeInfo> {
  const { t } = useTranslation();
  return useMemo(() => {
    const out: Record<DayKey, DayShadeInfo> = {};
    for (const [day, c] of Object.entries(cells)) {
      const label =
        c.percent !== null && c.level !== 'noReport'
          ? `${c.percent}%`
          : c.level === 'noReport'
          ? '–'
          : '';
      out[day] = {
        level: c.level,
        label,
        a11y:
          c.level === 'none'
            ? t('life.level_none')
            : c.level === 'noReport'
            ? t('life.level_noReport')
            : t('life.dayPercent', { percent: c.percent ?? 0 }),
      };
    }
    return out;
  }, [cells, t]);
}

/**
 * Which chart lines are hidden. Task lines past the fifth start hidden so
 * a big project's chart isn't crowded; every line can be toggled.
 */
export function useLineVisibility(taskIds: readonly string[]) {
  const [hidden, setHidden] = useState<Set<string>>(() =>
    initialHidden(taskIds),
  );
  const toggle = useCallback(
    (id: string) => setHidden(h => toggleLine(h, id)),
    [],
  );
  return { hidden, toggle };
}
