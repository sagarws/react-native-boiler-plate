import React from 'react';
import { useTranslation } from 'react-i18next';
import { DateField } from '@/features/life';
import { Button } from '@/shared/components';
import { todayKey } from '@/shared/utils/dayKey';
import {
  EMPTY_FILTERS,
  SORTS,
  type Filters,
  type SortKey,
} from '../services/views';
import type { Category, Tag } from '../types';
import { Chip, ChipRow, Field, Sheet } from './Sheet';

/** Category, tag, date range and sort order for the contact lists. */
export function FilterSheet({
  visible,
  filters,
  sort,
  categories,
  tags,
  onChange,
  onSort,
  onClose,
}: {
  visible: boolean;
  filters: Filters;
  sort: SortKey;
  categories: Category[];
  tags: Tag[];
  onChange: (next: Filters) => void;
  onSort: (next: SortKey) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const today = todayKey();
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <Sheet
      visible={visible}
      title={t('followUp.filters')}
      onClose={onClose}
      testID="filter-sheet"
      footer={
        <>
          <Button
            label={t('followUp.applyFilters')}
            onPress={onClose}
            testID="filter-apply"
          />
          <Button
            variant="ghost"
            label={t('followUp.clearFilters')}
            onPress={() => onChange({ ...EMPTY_FILTERS, query: filters.query })}
            testID="filter-clear"
          />
        </>
      }
    >
      <Field label={t('followUp.sortBy')}>
        <ChipRow>
          {SORTS.map(s => (
            <Chip
              key={s}
              label={t(`followUp.sort_${s}`)}
              selected={sort === s}
              onPress={() => onSort(s)}
              testID={`filter-sort-${s}`}
            />
          ))}
        </ChipRow>
      </Field>
      <Field label={t('followUp.category')}>
        <ChipRow>
          <Chip
            label={t('followUp.any')}
            selected={!filters.categoryId}
            onPress={() => set({ categoryId: '' })}
          />
          {categories.map(c => (
            <Chip
              key={c.id}
              label={c.name}
              color={c.color}
              selected={filters.categoryId === c.id}
              onPress={() =>
                set({ categoryId: filters.categoryId === c.id ? '' : c.id })
              }
              testID={`filter-category-${c.id}`}
            />
          ))}
        </ChipRow>
      </Field>
      <Field label={t('followUp.tag')}>
        <ChipRow>
          <Chip
            label={t('followUp.any')}
            selected={!filters.tagId}
            onPress={() => set({ tagId: '' })}
          />
          {tags.map(tag => (
            <Chip
              key={tag.id}
              label={tag.name}
              color={tag.color}
              selected={filters.tagId === tag.id}
              onPress={() =>
                set({ tagId: filters.tagId === tag.id ? '' : tag.id })
              }
              testID={`filter-tag-${tag.id}`}
            />
          ))}
        </ChipRow>
      </Field>
      <DateField
        label={t('followUp.fromDate')}
        value={filters.from || null}
        onChange={d => set({ from: d ?? '' })}
        today={today}
        allowClear
        emptyLabel={t('followUp.any')}
        testID="filter-from"
      />
      <DateField
        label={t('followUp.toDate')}
        value={filters.to || null}
        onChange={d => set({ to: d ?? '' })}
        today={today}
        min={filters.from || undefined}
        allowClear
        emptyLabel={t('followUp.any')}
        testID="filter-to"
      />
    </Sheet>
  );
}
