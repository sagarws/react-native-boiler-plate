import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNow } from '@/features/followup';
import { useDrawer } from '@/navigation/drawer';
import type { MainStackParamList } from '@/navigation/types';
import { Header, TabBar } from '@/shared/components';
import { useTheme } from '@/theme';
import { BudgetSheet } from '../components/BudgetSheet';
import { CategorySheet } from '../components/CategorySheet';
import { EditExpenseSheet } from '../components/EditExpenseSheet';
import { FilterSheet } from '../components/FilterSheet';
import { PaymentSheets } from '../components/PaymentSheets';
import { AddTab } from '../components/tabs/AddTab';
import { AnalyticsTab } from '../components/tabs/AnalyticsTab';
import { HistoryTab } from '../components/tabs/HistoryTab';
import { OverviewTab } from '../components/tabs/OverviewTab';
import {
  EXPENSE_TABS,
  type ExpenseTab,
  type TabProps,
} from '../components/tabs/shared';
import { useCategories, useExpenseData } from '../hooks/useExpense';
import { useExpenseForm } from '../hooks/useExpenseForm';
import { useHistory } from '../hooks/useHistory';
import { useUpiPayment } from '../hooks/useUpiPayment';
import { EMPTY_FILTERS } from '../services/filters';
import type { Expense } from '../types';
import { formatInr } from '../utils/money';

/**
 * Expense Tracker — the app's start screen. Overview · Add · History ·
 * Analytics, with Scan QR & Pay for UPI. Everything is stored on the device.
 */
export default function ExpenseTrackerScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, spacing } = useTheme();
  const { openDrawer } = useDrawer();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'ExpenseTracker'>>();
  const data = useExpenseData();
  const now = useNow();
  const lookup = useCategories(data.categories);
  const form = useExpenseForm();
  const payment = useUpiPayment();
  const history = useHistory(data.expenses, lookup.nameById);

  const [tab, setTab] = useState<ExpenseTab>(params?.tab ?? 'overview');
  const [editing, setEditing] = useState<Expense | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (params?.tab) setTab(params.tab);
  }, [params?.tab]);

  const usageMap = useMemo(() => {
    const map = new Map<string, number>();
    data.expenses.forEach(e =>
      map.set(e.categoryId, (map.get(e.categoryId) ?? 0) + 1),
    );
    return map;
  }, [data.expenses]);
  const usage = useCallback((id: string) => usageMap.get(id) ?? 0, [usageMap]);

  const save = () => {
    setSaved(null);
    const result = form.save();
    if (result?.ok) {
      setSaved(
        t('expense.savedMessage', { amount: formatInr(result.value.amount) }),
      );
      form.reset();
    }
  };

  const payRequest = () => ({
    amountText: form.draft.amount,
    categoryId: form.draft.categoryId,
    description: form.draft.description,
  });

  const scan = () => {
    setSaved(null);
    setTab('add');
    payment.start(payRequest());
  };

  const scanFromGallery = () => {
    setSaved(null);
    setTab('add');
    payment.startFromGallery(payRequest());
  };

  const onConfirmed = (expense: Expense) => {
    setTab('add');
    const amount = formatInr(expense.amount);
    setSaved(t(`expense.confirmed_${expense.status}`, { amount }));
    // A failed payment keeps the form filled so it can be retried.
    if (expense.status !== 'failed') form.reset();
  };

  const showPending = () => {
    history.setFilters({ ...EMPTY_FILTERS, statuses: ['pending'] });
    setTab('history');
  };

  const common: TabProps = {
    data,
    lookup,
    now,
    bottomPad: bottom + spacing.xl,
    openExpense: setEditing,
  };

  let content: React.ReactNode;
  switch (tab) {
    case 'add':
      content = (
        <AddTab
          {...common}
          form={form}
          saved={saved}
          problem={payment.problem}
          busy={payment.step.kind !== 'idle'}
          onSave={save}
          onScan={scan}
          onGallery={scanFromGallery}
          onDismissProblem={payment.clearProblem}
          onOpenSettings={payment.openSettings}
          onManageCategories={() => setCategoriesOpen(true)}
        />
      );
      break;
    case 'history':
      content = (
        <HistoryTab
          {...common}
          history={history}
          onOpenFilters={() => setFiltersOpen(true)}
        />
      );
      break;
    case 'analytics':
      content = <AnalyticsTab {...common} />;
      break;
    default:
      content = (
        <OverviewTab
          {...common}
          onAdd={() => setTab('add')}
          onScan={() => setTab('add')}
          onBudget={() => setBudgetOpen(true)}
          onPending={showPending}
          onSeeAll={() => setTab('history')}
        />
      );
  }

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('expense.title')} onMenuPress={openDrawer} />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={EXPENSE_TABS.map(value => ({
          value,
          label: t(`expense.tab_${value}`),
        }))}
        accessibilityLabel={t('expense.tabs')}
        testID="expense-tab"
      />
      <View style={styles.screen}>{content}</View>

      {editing ? (
        <EditExpenseSheet
          key={editing.id}
          expense={editing}
          onClose={() => setEditing(null)}
          categories={data.categories}
          lookup={lookup}
          onManageCategories={() => setCategoriesOpen(true)}
        />
      ) : null}
      {categoriesOpen ? (
        <CategorySheet
          visible
          onClose={() => setCategoriesOpen(false)}
          categories={data.categories}
          lookup={lookup}
          usage={usage}
        />
      ) : null}
      {budgetOpen ? (
        <BudgetSheet
          visible
          budget={data.settings.monthlyBudget}
          onClose={() => setBudgetOpen(false)}
        />
      ) : null}
      {filtersOpen ? (
        <FilterSheet
          visible
          value={history.filters}
          onApply={next => {
            history.setFilters(next);
            setFiltersOpen(false);
          }}
          onClose={() => setFiltersOpen(false)}
          categories={data.categories}
          lookup={lookup}
        />
      ) : null}
      <PaymentSheets
        payment={payment}
        lookup={lookup}
        onConfirmed={onConfirmed}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
