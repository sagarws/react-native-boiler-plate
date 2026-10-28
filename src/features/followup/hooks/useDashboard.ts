import { useMemo, useState } from 'react';
import { toDayKey } from '@/shared/utils/dayKey';
import {
  buildRows,
  EMPTY_FILTERS,
  summarize,
  upcomingBirthdays,
  type Filters,
  type FollowUpView,
  type SortKey,
} from '../services/views';
import { useFollowUpData, useNow } from './useFollowUp';

/** The dashboard's view, filters and sort, and the rows they produce. */
export function useDashboard(initialView?: FollowUpView) {
  const data = useFollowUpData();
  const now = useNow();
  const [view, setView] = useState<FollowUpView>(
    initialView ?? data.settings.defaultView,
  );
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>(
    view === 'all' ? 'name' : 'dueSoonest',
  );

  const rows = useMemo(
    () => buildRows(data, view, filters, sort, now),
    [data, view, filters, sort, now],
  );
  const summary = useMemo(() => summarize(data, now), [data, now]);
  const birthdays = useMemo(
    () => upcomingBirthdays(data, toDayKey(now), 14),
    [data, now],
  );
  const categories = useMemo(
    () => new Map(data.categories.map(c => [c.id, c])),
    [data.categories],
  );
  const tags = useMemo(
    () => new Map(data.tags.map(t => [t.id, t])),
    [data.tags],
  );
  const activeFilters =
    (filters.categoryId ? 1 : 0) +
    (filters.tagId ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0);

  return {
    data,
    now,
    view,
    setView,
    filters,
    setFilters,
    sort,
    setSort,
    rows,
    summary,
    birthdays,
    categories,
    tags,
    activeFilters,
  };
}
