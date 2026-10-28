import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDay, StatCard } from '@/features/life';
import { ROUTES } from '@/navigation/routes';
import type { MainStackParamList } from '@/navigation/types';
import { Button, EmptyState, Header, Icon, TabBar } from '@/shared/components';
import { useTheme } from '@/theme';
import { useActionSheets } from '../components/ActionSheets';
import { ContactCard } from '../components/ContactCard';
import { FilterSheet } from '../components/FilterSheet';
import { useDashboard } from '../hooks/useDashboard';
import { FOLLOW_UP_VIEWS, type FollowUpView } from '../services/views';

/**
 * Follow Up dashboard: today's numbers, upcoming birthdays, and the contact
 * lists (Pending · Today · Overdue · Upcoming · Done · All) with search,
 * filters and one-tap call / WhatsApp / done / schedule on every card.
 */
export default function FollowUpScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MainStackParamList, 'FollowUp'>>();
  const d = useDashboard(params?.view);
  const sheets = useActionSheets();
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (params?.view) d.setView(params.view);
    // Only when opened with a different view (e.g. from a notification).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.view]);

  const openContact = (contactId: string) =>
    navigation.navigate(ROUTES.FOLLOW_UP_CONTACT, { contactId });
  const addContact = () =>
    navigation.navigate(ROUTES.FOLLOW_UP_CONTACT_FORM, {});
  const goView = (view: FollowUpView) => d.setView(view);

  const s = d.summary;
  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
      <Button
        label={t('followUp.addContact')}
        iconName="userPlus"
        onPress={addContact}
        testID="followup-add"
      />
      <View style={[styles.grid, { gap: spacing.sm }]}>
        <View style={styles.cell}>
          <StatCard
            label={t('followUp.sumContacts')}
            value={String(s.contacts)}
            onPress={() => goView('all')}
            testID="sum-contacts"
          />
        </View>
        <View style={styles.cell}>
          <StatCard
            label={t('followUp.sumToday')}
            value={String(s.dueToday)}
            onPress={() => goView('today')}
            testID="sum-today"
          />
        </View>
        <View style={styles.cell}>
          <StatCard
            label={t('followUp.sumOverdue')}
            value={String(s.overdue)}
            tone={s.overdue ? 'warning' : undefined}
            onPress={() => goView('overdue')}
            testID="sum-overdue"
          />
        </View>
        <View style={styles.cell}>
          <StatCard
            label={t('followUp.sumDoneToday')}
            value={String(s.doneToday)}
            tone={s.doneToday ? 'success' : undefined}
            onPress={() => goView('done')}
            testID="sum-done"
          />
        </View>
        <View style={styles.cell}>
          <StatCard
            label={t('followUp.sumUpcoming')}
            value={String(s.upcoming)}
            onPress={() => goView('upcoming')}
            testID="sum-upcoming"
          />
        </View>
      </View>

      {d.birthdays.length ? (
        <View
          style={[
            {
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.lg,
              padding: spacing.md,
              gap: spacing.xs,
            },
          ]}
          testID="birthdays"
        >
          <View style={[styles.row, { gap: spacing.xs }]}>
            <Icon name="cake" size={16} color={colors.warning} />
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('followUp.birthdaysTitle')}
            </Text>
          </View>
          {d.birthdays.slice(0, 3).map(b => (
            <Pressable
              key={b.contact.id}
              onPress={() => openContact(b.contact.id)}
              accessibilityRole="button"
            >
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {b.contact.name} ·{' '}
                {b.inDays === 0
                  ? t('followUp.birthdayToday')
                  : t('followUp.birthdayIn', {
                      count: b.inDays,
                      date: formatDay(b.day),
                    })}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

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
            testID="followup-search"
            value={d.filters.query}
            onChangeText={query => d.setFilters({ ...d.filters, query })}
            placeholder={t('followUp.searchPlaceholder')}
            placeholderTextColor={colors.placeholder}
            accessibilityLabel={t('followUp.searchPlaceholder')}
            style={[
              typography.body,
              styles.flex,
              { color: colors.textPrimary },
            ]}
          />
        </View>
        <Pressable
          testID="followup-filters"
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            d.activeFilters
              ? t('followUp.filtersActive', { count: d.activeFilters })
              : t('followUp.filters')
          }
          style={[
            styles.filterBtn,
            {
              borderRadius: radius.md,
              backgroundColor: d.activeFilters
                ? colors.primary
                : colors.surfaceMuted,
            },
          ]}
        >
          <Icon
            name="slidersHorizontal"
            size={20}
            color={
              d.activeFilters ? colors.primaryForeground : colors.textPrimary
            }
          />
        </Pressable>
      </View>
    </View>
  );

  const emptyKey =
    d.data.contacts.length === 0 ? 'noContacts' : `empty_${d.view}`;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header
        label={t('followUp.title')}
        right={
          <View style={styles.row}>
            <Pressable
              onPress={addContact}
              accessibilityRole="button"
              accessibilityLabel={t('followUp.addContact')}
              style={styles.headerBtn}
              testID="followup-add-header"
            >
              <Icon name="userPlus" size={22} color={colors.textPrimary} />
            </Pressable>
            <Pressable
              onPress={() =>
                navigation.navigate(ROUTES.SETTINGS, { tab: 'followup' })
              }
              accessibilityRole="button"
              accessibilityLabel={t('followUp.settingsTitle')}
              style={styles.headerBtn}
              testID="followup-settings"
            >
              <Icon name="settings" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
        }
      />
      <TabBar
        scrollable
        value={d.view}
        onChange={d.setView}
        tabs={FOLLOW_UP_VIEWS.map(value => ({
          value,
          label: t(`followUp.view_${value}`),
        }))}
        accessibilityLabel={t('followUp.views')}
        testID="followup-tab"
      />
      <FlatList
        testID="followup-list"
        data={d.rows}
        keyExtractor={row => row.contact.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
        }}
        ListEmptyComponent={
          <EmptyState
            icon={d.data.contacts.length ? 'circleCheck' : 'users'}
            title={t(`followUp.${emptyKey}`)}
            message={
              d.data.contacts.length ? undefined : t('followUp.noContactsHint')
            }
            action={
              d.data.contacts.length
                ? undefined
                : { label: t('followUp.addContact'), onPress: addContact }
            }
            compact
          />
        }
        renderItem={({ item: row }) => (
          <ContactCard
            row={row}
            categories={d.categories}
            tags={d.tags}
            testID={`contact-${row.contact.id}`}
            actions={{
              onOpen: () => openContact(row.contact.id),
              onCall: () => sheets.call(row.contact, row.activity ?? row.next),
              onWhatsApp: () =>
                sheets.whatsapp(row.contact, row.activity ?? row.next),
              onNote: () => sheets.note(row.contact),
              onSchedule: () => sheets.schedule(row.contact),
              onDone:
                (row.activity ?? row.next) &&
                !(row.activity ?? row.next)!.completedAt
                  ? () =>
                      sheets.complete(row.contact, (row.activity ?? row.next)!)
                  : undefined,
            }}
          />
        )}
      />
      {sheets.element}
      <FilterSheet
        visible={filtersOpen}
        filters={d.filters}
        sort={d.sort}
        categories={d.data.categories.filter(c => c.isActive)}
        tags={d.data.tags.filter(tag => tag.isActive)}
        onChange={d.setFilters}
        onSort={d.setSort}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );
}

function Separator() {
  const { spacing } = useTheme();
  return <View style={{ height: spacing.sm }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { flexBasis: '31%', flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  search: { flex: 1, borderWidth: 1, minHeight: 48 },
  filterBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtn: { padding: 8 },
});
