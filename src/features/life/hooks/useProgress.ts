import { useMemo } from 'react';
import type { LifeData } from '../types';
import type { DayKey, Project, Task } from '../types';
import type { EvaluateInput } from '../services/periods';
import {
  projectCalendar,
  projectChart,
  projectTasks,
  projectWindow,
  sampleDays,
  standingCounts,
  taskCalendar,
  taskPeriodBars,
  taskSummary,
} from '../services/progress';
import {
  addDays,
  daysInMonth,
  maxDay,
  minDay,
  monthStart,
} from '../utils/dates';

/** First and last day of the month containing [month]. */
export function monthRange(month: DayKey): { from: DayKey; to: DayKey } {
  const from = monthStart(month);
  return { from, to: addDays(from, daysInMonth(from) - 1) };
}

const inputOf = (data: LifeData, today: DayKey): EvaluateInput => ({
  reports: data.reports,
  reviews: data.reviews,
  today,
});

/** Everything the task page shows, for the month on screen. */
export function useTaskDetail(
  data: LifeData,
  task: Task | undefined,
  month: DayKey,
  today: DayKey,
) {
  return useMemo(() => {
    if (!task) return null;
    const inp = inputOf(data, today);
    const { from, to } = monthRange(month);
    // Chart: from the task's start to its end (or today), every period.
    const chartTo = task.endDate
      ? minDay(task.endDate, maxDay(today, task.startDate))
      : maxDay(today, task.startDate);
    return {
      summary: taskSummary(task, inp),
      calendar: taskCalendar(task, inp, from, to),
      bars: taskPeriodBars(task, inp, task.startDate, chartTo),
      reports: data.reports
        .filter(r => r.taskId === task.id)
        .sort((a, b) =>
          a.day === b.day
            ? a.reportedAt < b.reportedAt
              ? 1
              : -1
            : a.day < b.day
            ? 1
            : -1,
        ),
      project: data.projects.find(p => p.id === task.projectId) ?? null,
    };
  }, [data, task, month, today]);
}

/** Calendar, chart and task counts for the project page. */
export function useProjectDetail(
  data: LifeData,
  project: Project | undefined,
  month: DayKey,
  today: DayKey,
) {
  return useMemo(() => {
    if (!project) return null;
    const inp = inputOf(data, today);
    const tasks = projectTasks(data, project.id);
    const { from, to } = monthRange(month);
    const window = projectWindow(project, tasks, today);
    const chart = projectChart(
      project,
      tasks,
      data.reports,
      sampleDays(window.from, window.to, 30),
    );
    const last = chart.days.length - 1;
    return {
      tasks,
      counts: standingCounts(tasks, inp),
      calendar: projectCalendar(tasks, inp, from, to),
      chart,
      /** Overall progress now: average actual vs average target (cumulative %). */
      overall:
        last >= 0
          ? {
              actual: chart.averageActual[last],
              target: chart.averageTarget[last],
            }
          : { actual: null, target: null },
    };
  }, [data, project, month, today]);
}
