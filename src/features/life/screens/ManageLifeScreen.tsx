import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import type { MainStackParamList } from '@/navigation/types';
import { Header, TabBar } from '@/shared/components';
import { useTheme } from '@/theme';
import { LogProgressSheet } from '../components/LogProgressSheet';
import { ReviewSheet } from '../components/ReviewSheet';
import { CalendarTab } from '../components/tabs/CalendarTab';
import { DashboardTab } from '../components/tabs/DashboardTab';
import { HistoryTab } from '../components/tabs/HistoryTab';
import { InsightsTab } from '../components/tabs/InsightsTab';
import { ProjectsTab } from '../components/tabs/ProjectsTab';
import { TodayTab } from '../components/tabs/TodayTab';
import {
  LIFE_TABS,
  type LifeTab,
  type TabProps,
} from '../components/tabs/shared';
import { useClock, useLifeData } from '../hooks/useLife';
import type { PeriodState } from '../services/periods';
import type { Task } from '../types';

const TABS: Record<LifeTab, React.ComponentType<TabProps>> = {
  dashboard: DashboardTab,
  projects: ProjectsTab,
  today: TodayTab,
  calendar: CalendarTab,
  history: HistoryTab,
  insights: InsightsTab,
};

/**
 * Manage Life: Dashboard · Projects · Today · Calendar · History · Insights.
 * Progress logging and period-end reasons open as sheets over any tab, so a
 * report never needs more than one or two taps.
 */
export default function ManageLifeScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, spacing } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MainStackParamList, 'ManageLife'>>();
  const data = useLifeData();
  const { now, today } = useClock();
  const [tab, setTab] = useState<LifeTab>(params?.tab ?? 'dashboard');
  const [logging, setLogging] = useState<Task | null>(null);
  const [reviewing, setReviewing] = useState<
    (PeriodState & { task: Task }) | null
  >(null);

  useEffect(() => {
    if (params?.tab) setTab(params.tab);
  }, [params?.tab]);

  const Content = TABS[tab];
  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('life.title')} />
      <TabBar
        scrollable
        value={tab}
        onChange={setTab}
        tabs={LIFE_TABS.map(value => ({
          value,
          label: t(`life.tab_${value}`),
        }))}
        accessibilityLabel={t('life.tabs')}
        testID="life-tab"
      />
      <ScrollView
        key={tab}
        testID="life-scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
        }}
      >
        <Content
          data={data}
          today={today}
          now={now}
          onLog={setLogging}
          onReview={setReviewing}
          onOpenProject={projectId =>
            navigation.navigate(ROUTES.LIFE_PROJECT, { projectId })
          }
          onNewProject={() => navigation.navigate(ROUTES.LIFE_PROJECT_FORM, {})}
          onTab={setTab}
        />
      </ScrollView>
      <LogProgressSheet
        task={logging}
        today={today}
        onClose={() => setLogging(null)}
      />
      <ReviewSheet
        item={reviewing}
        today={today}
        onClose={() => setReviewing(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
