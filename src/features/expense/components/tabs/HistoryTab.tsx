import React from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { EmptyState, Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import type { History } from '../../hooks/useHistory';
import type { Expense } from '../../types';
import { formatInr } from '../../utils/money';
import { TransactionRow } from '../TransactionRow';
import type { TabProps } from './shared';

/** Searchable, filterable list of every transaction; tap one to edit it. */
export function HistoryTab({
  data,
  lookup,
  bottomPad,
  openExpense,
  history,
  onOpenFilters,
}: TabProps & { history: History; onOpenFilters: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const { filters, setFilters, results, activeFilters, paidTotal } = history;

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <View
          style={[
            styles.search,
            styles.row,
            {
              borderColor: colors.border,
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
              gap: spacing.sm,
            },
          ]}
        >
          <Icon name="search" size={18} color={colors.textSecondary} />
          <TextInput
            testID="history-search"
            value={filters.query}
            onChangeText={query => setFilters({ ...filters, query })}
            placeholder={t('expense.searchPlaceholder')}
            placeholderTextColor={colors.placeholder}
            accessibilityLabel={t('expense.searchPlaceholder')}
            style={[
              typography.body,
              styles.flex,
              { color: colors.textPrimary },
            ]}
          />
        </View>
        <Pressable
          testID="history-filters"
          onPress={onOpenFilters}
          accessibilityRole="button"
          accessibilityLabel={
            activeFilters
              ? t('expense.filtersActive', { count: activeFilters })
              : t('expense.filters')
          }
          style={[
            styles.filterBtn,
            {
              borderRadius: radius.md,
              backgroundColor: activeFilters
                ? colors.primary
                : colors.surfaceMuted,
            },
          ]}
        >
          <Icon
            name="filter"
            size={20}
            color={
              activeFilters ? colors.primaryForeground : colors.textPrimary
            }
          />
        </Pressable>
      </View>
      {data.expenses.length ? (
        <Text
          testID="history-count"
          style={[typography.caption, { color: colors.textSecondary }]}
        >
          {t('expense.resultsSummary', {
            count: results.length,
            amount: formatInr(paidTotal),
          })}
        </Text>
      ) : null}
    </View>
  );

  return (
    <FlatList<Expense>
      testID="expense-history"
      data={results}
      keyExtractor={item => item.id}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: bottomPad,
        gap: spacing.sm,
      }}
      renderItem={({ item }) => (
        <TransactionRow
          expense={item}
          category={lookup.get(item.categoryId)}
          categoryName={lookup.nameById(item.categoryId)}
          onPress={() => openExpense(item)}
          testID={`txn-${item.id}`}
        />
      )}
      ListEmptyComponent={
        data.expenses.length ? (
          <EmptyState
            compact
            icon="search"
            title={t('expense.noMatches')}
            message={t('expense.noMatchesHint')}
            testID="history-no-matches"
          />
        ) : (
          <EmptyState
            compact
            icon="receipt"
            title={t('expense.emptyTitle')}
            message={t('expense.emptyMessage')}
            testID="history-empty"
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  search: { flex: 1, borderWidth: 1, minHeight: 48 },
  flex: { flex: 1 },
  filterBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
