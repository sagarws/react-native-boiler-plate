import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/features/life';
import type { IconName } from '@/shared/assets';
import {
  Button,
  COUNTRIES,
  ExpandableCard,
  Icon,
  ListRow,
  Notice,
  ToggleSwitch,
} from '@/shared/components';
import { requestNotificationPermission } from '@/shared/utils';
import { categoryColor, useTheme } from '@/theme';
import { followUpActions, useFollowUpData } from '../hooks/useFollowUp';
import { useReminderState } from '../hooks/useReminderSync';
import { activitiesCsv, backupJson, contactsCsv } from '../services/export';
import { followUpNative } from '../services/native.service';
import {
  DEFAULT_VIEWS,
  FOLLOW_UP_TYPES,
  LEAD_MINUTES,
  type Category,
  type FollowUpSettings as Settings,
  type Tag,
} from '../types';
import { parseTime } from '../utils/time';
import { LabelEditorSheet, type LabelTarget } from './LabelEditorSheet';
import { Chip, ChipRow, Field } from './Sheet';

type Section = 'reminders' | 'defaults' | 'labels' | 'data';

/** Suggested starter labels (translated, then saved as ordinary user data). */
const SUGGESTED_CATEGORIES: readonly {
  key: string;
  color: string;
  icon: IconName;
}[] = [
  { key: 'client', color: 'blue', icon: 'circleCheck' },
  { key: 'prospect', color: 'amber', icon: 'sparkles' },
  { key: 'friend', color: 'emerald', icon: 'users' },
  { key: 'family', color: 'rose', icon: 'cake' },
  { key: 'partner', color: 'indigo', icon: 'building2' },
  { key: 'vendor', color: 'teal', icon: 'layers' },
  { key: 'other', color: 'slate', icon: 'tag' },
];
const SUGGESTED_TAGS: readonly { key: string; color: string }[] = [
  { key: 'highPriority', color: 'rose' },
  { key: 'interested', color: 'emerald' },
  { key: 'paymentPending', color: 'orange' },
  { key: 'callBack', color: 'blue' },
  { key: 'meetingRequired', color: 'violet' },
];

/** Follow Up's tab in Settings. */
export function FollowUpSettings() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const data = useFollowUpData();
  const s = data.settings;
  const reminderState = useReminderState();
  const [open, setOpen] = useState<Section | null>(null);
  const [label, setLabel] = useState<LabelTarget | null>(null);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const [preferred, setPreferred] = useState(s.preferredTime);
  const section = (key: Section) => ({
    expanded: open === key,
    onToggle: () => setOpen(c => (c === key ? null : key)),
  });
  const update = (patch: Partial<Settings>) =>
    followUpActions.updateSettings(patch);
  const caption = [typography.caption, { color: colors.textSecondary }];

  const enableReminders = async (
    key: 'remindersEnabled' | 'birthdayReminders',
    on: boolean,
  ) => {
    if (on && !(await requestNotificationPermission())) {
      setMessage({ tone: 'error', text: t('followUp.notificationsBlocked') });
    }
    update({ [key]: on });
  };

  const exportFile = async (kind: 'contacts' | 'history' | 'backup') => {
    const stamp = new Date().toISOString().slice(0, 10);
    const [name, mime, content] =
      kind === 'contacts'
        ? [`followup-contacts-${stamp}.csv`, 'text/csv', contactsCsv(data)]
        : kind === 'history'
        ? [`followup-history-${stamp}.csv`, 'text/csv', activitiesCsv(data)]
        : [
            `followup-backup-${stamp}.json`,
            'application/json',
            backupJson(data, new Date()),
          ];
    const result = await followUpNative.saveText(name, mime, content);
    if (!result.ok)
      setMessage({ tone: 'error', text: t('followUp.exportFailed') });
    else if (result.value)
      setMessage({ tone: 'success', text: t('followUp.exported', { name }) });
  };

  const confirmDeleteLabel = (target: LabelTarget) => {
    if (!target.item) return;
    const item = target.item;
    const used =
      target.kind === 'category'
        ? data.contacts.filter(c => c.categoryId === item.id).length
        : data.contacts.filter(c => c.tagIds.includes(item.id)).length;
    Alert.alert(
      t(
        target.kind === 'category'
          ? 'followUp.deleteCategoryTitle'
          : 'followUp.deleteTagTitle',
      ),
      t(
        target.kind === 'category'
          ? 'followUp.deleteCategoryMessage'
          : 'followUp.deleteTagMessage',
        {
          name: item.name,
          count: used,
        },
      ),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('followUp.delete'),
          style: 'destructive',
          onPress: () =>
            target.kind === 'category'
              ? followUpActions.deleteCategory(item.id)
              : followUpActions.deleteTag(item.id),
        },
      ],
    );
  };

  const confirmDeleteAll = () =>
    Alert.alert(
      t('followUp.deleteAllTitle'),
      t('followUp.deleteAllMessage', { count: data.contacts.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('followUp.deleteAll'),
          style: 'destructive',
          onPress: () => {
            followUpActions.deleteAll();
            setMessage({ tone: 'success', text: t('followUp.deletedAll') });
          },
        },
      ],
    );

  const labelRow = (target: LabelTarget, divider: boolean) => {
    const item = target.item as Category | Tag;
    return (
      <View
        key={item.id}
        style={[
          styles.row,
          { gap: spacing.sm, paddingVertical: spacing.sm },
          divider && {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
          },
        ]}
      >
        <View
          style={[styles.dot, { backgroundColor: categoryColor(item.color) }]}
        >
          {target.kind === 'category' ? (
            <Icon
              name={(item as Category).icon as IconName}
              size={14}
              color={colors.primaryForeground}
            />
          ) : null}
        </View>
        <Pressable
          style={styles.flex}
          onPress={() => setLabel(target)}
          accessibilityRole="button"
          accessibilityLabel={t('followUp.editNamed', { name: item.name })}
          testID={`label-edit-${item.id}`}
        >
          <Text
            style={[
              typography.body,
              {
                color: item.isActive
                  ? colors.textPrimary
                  : colors.textSecondary,
              },
            ]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {!item.isActive ? (
            <Text style={caption}>{t('followUp.inactive')}</Text>
          ) : null}
        </Pressable>
        <ToggleSwitch
          isOn={item.isActive}
          onToggle={on =>
            target.kind === 'category'
              ? followUpActions.setCategoryActive(item.id, on)
              : followUpActions.setTagActive(item.id, on)
          }
          accessibilityLabel={t('followUp.activeNamed', { name: item.name })}
        />
        <Pressable
          onPress={() => confirmDeleteLabel(target)}
          accessibilityRole="button"
          accessibilityLabel={t('followUp.deleteNamed', { name: item.name })}
          hitSlop={8}
          testID={`label-delete-${item.id}`}
        >
          <Icon name="trash2" size={18} color={colors.error} />
        </Pressable>
      </View>
    );
  };

  const reminderSummary =
    reminderState.kind === 'scheduled'
      ? t('followUp.remindersScheduled', { count: reminderState.count })
      : reminderState.kind === 'blocked'
      ? t('followUp.notificationsBlocked')
      : reminderState.kind === 'unavailable'
      ? t('followUp.remindersUnavailable')
      : reminderState.kind === 'failed'
      ? t('followUp.remindersFailed')
      : t('common.off');

  const toggleRow = (
    title: string,
    subtitle: string,
    value: boolean,
    onToggle: (v: boolean) => void,
    testID: string,
  ) => (
    <ListRow
      title={title}
      subtitle={subtitle}
      testID={testID}
      right={
        <ToggleSwitch
          isOn={value}
          onToggle={onToggle}
          accessibilityLabel={title}
        />
      }
    />
  );

  const dials = [...new Map(COUNTRIES.map(c => [c.dial, c])).values()];

  return (
    <>
      {message ? (
        <Notice
          tone={message.tone}
          message={message.text}
          onDismiss={() => setMessage(null)}
        />
      ) : null}

      <ExpandableCard
        title={t('followUp.sectionReminders')}
        summary={reminderSummary}
        icon="bell"
        footer={t('followUp.remindersFooter')}
        testID="fu-settings-reminders"
        padded
        {...section('reminders')}
      >
        <View style={{ gap: spacing.md }}>
          {toggleRow(
            t('followUp.remindersEnabled'),
            t('followUp.remindersEnabledHint'),
            s.remindersEnabled,
            v => {
              void enableReminders('remindersEnabled', v);
            },
            'fu-reminders',
          )}
          {toggleRow(
            t('followUp.reminderByDefault'),
            t('followUp.reminderByDefaultHint'),
            s.reminderByDefault,
            v => update({ reminderByDefault: v }),
            'fu-reminder-default',
          )}
          {toggleRow(
            t('followUp.overdueReminders'),
            t('followUp.overdueRemindersHint'),
            s.overdueReminders,
            v => update({ overdueReminders: v }),
            'fu-overdue',
          )}
          {toggleRow(
            t('followUp.birthdayReminders'),
            t('followUp.birthdayRemindersHint'),
            s.birthdayReminders,
            v => {
              void enableReminders('birthdayReminders', v);
            },
            'fu-birthdays',
          )}
          <Field label={t('followUp.leadTime')}>
            <ChipRow>
              {LEAD_MINUTES.map(m => (
                <Chip
                  key={m}
                  label={t(`followUp.lead_${m}`)}
                  selected={s.leadMinutes === m}
                  onPress={() => update({ leadMinutes: m })}
                  testID={`fu-lead-${m}`}
                />
              ))}
            </ChipRow>
          </Field>
          <FormField
            label={t('followUp.preferredTime')}
            hint={t('followUp.preferredTimeHint')}
            value={preferred}
            onChangeText={setPreferred}
            onEndEditing={() => {
              const time = parseTime(preferred);
              if (time) update({ preferredTime: time });
              setPreferred(time ?? s.preferredTime);
            }}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            testID="fu-preferred-time"
          />
        </View>
      </ExpandableCard>

      <ExpandableCard
        title={t('followUp.sectionDefaults')}
        summary={`${s.defaultDial} · ${t(
          `followUp.type_${s.defaultType}`,
        )} · ${t(`followUp.view_${s.defaultView}`)}`}
        icon="slidersHorizontal"
        testID="fu-settings-defaults"
        padded
        {...section('defaults')}
      >
        <View style={{ gap: spacing.md }}>
          <Field label={t('followUp.defaultDial')}>
            <ChipRow>
              {dials.map(c => (
                <Chip
                  key={c.dial}
                  label={`${c.flag} ${c.dial}`}
                  selected={s.defaultDial === c.dial}
                  onPress={() => update({ defaultDial: c.dial })}
                  testID={`fu-dial-${c.dial}`}
                />
              ))}
            </ChipRow>
          </Field>
          <Field label={t('followUp.defaultType')}>
            <ChipRow>
              {FOLLOW_UP_TYPES.map(type => (
                <Chip
                  key={type}
                  label={t(`followUp.type_${type}`)}
                  selected={s.defaultType === type}
                  onPress={() => update({ defaultType: type })}
                />
              ))}
            </ChipRow>
          </Field>
          <Field label={t('followUp.defaultView')}>
            <ChipRow>
              {DEFAULT_VIEWS.map(v => (
                <Chip
                  key={v}
                  label={t(`followUp.view_${v}`)}
                  selected={s.defaultView === v}
                  onPress={() => update({ defaultView: v })}
                />
              ))}
            </ChipRow>
          </Field>
        </View>
      </ExpandableCard>

      <ExpandableCard
        title={t('followUp.sectionLabels')}
        summary={t('followUp.labelsSummary', {
          categories: data.categories.length,
          tags: data.tags.length,
        })}
        icon="tag"
        testID="fu-settings-labels"
        padded
        {...section('labels')}
      >
        <View style={{ gap: spacing.md }}>
          <Text style={[typography.label, { color: colors.textPrimary }]}>
            {t('followUp.categories')}
          </Text>
          {data.categories.length ? (
            <View>
              {data.categories.map((c, i) =>
                labelRow({ kind: 'category', item: c }, i > 0),
              )}
            </View>
          ) : (
            <Text style={caption}>{t('followUp.noCategories')}</Text>
          )}
          <Button
            size="sm"
            variant="soft"
            iconName="plus"
            label={t('followUp.newCategory')}
            onPress={() => setLabel({ kind: 'category', item: null })}
            testID="fu-add-category"
          />
          <Text style={[typography.label, { color: colors.textPrimary }]}>
            {t('followUp.tags')}
          </Text>
          {data.tags.length ? (
            <View>
              {data.tags.map((tag, i) =>
                labelRow({ kind: 'tag', item: tag }, i > 0),
              )}
            </View>
          ) : (
            <Text style={caption}>{t('followUp.noTags')}</Text>
          )}
          <Button
            size="sm"
            variant="soft"
            iconName="plus"
            label={t('followUp.newTag')}
            onPress={() => setLabel({ kind: 'tag', item: null })}
            testID="fu-add-tag"
          />
          <Button
            size="sm"
            variant="ghost"
            iconName="sparkles"
            label={t('followUp.addSuggestions')}
            onPress={() => {
              const added = followUpActions.addSuggestions(
                SUGGESTED_CATEGORIES.map(c => ({
                  name: t(`followUp.suggestCat_${c.key}`),
                  color: c.color,
                  icon: c.icon,
                })),
                SUGGESTED_TAGS.map(tag => ({
                  name: t(`followUp.suggestTag_${tag.key}`),
                  color: tag.color,
                })),
              );
              setMessage({
                tone: 'success',
                text: t('followUp.suggestionsAdded', { count: added }),
              });
            }}
            testID="fu-suggestions"
          />
        </View>
      </ExpandableCard>

      <ExpandableCard
        title={t('followUp.sectionData')}
        summary={t('followUp.dataSummary', { count: data.contacts.length })}
        icon="shieldCheck"
        footer={t('followUp.privacyNote')}
        testID="fu-settings-data"
        {...section('data')}
      >
        <ListRow
          icon="download"
          title={t('followUp.exportContacts')}
          subtitle={t('followUp.exportCsvHint')}
          onPress={() => {
            void exportFile('contacts');
          }}
          testID="fu-export-contacts"
        />
        <ListRow
          divider
          icon="download"
          title={t('followUp.exportHistory')}
          subtitle={t('followUp.exportCsvHint')}
          onPress={() => {
            void exportFile('history');
          }}
          testID="fu-export-history"
        />
        <ListRow
          divider
          icon="download"
          title={t('followUp.exportBackup')}
          subtitle={t('followUp.exportBackupHint')}
          onPress={() => {
            void exportFile('backup');
          }}
          testID="fu-export-backup"
        />
        <ListRow
          divider
          destructive
          icon="trash2"
          title={t('followUp.deleteAll')}
          subtitle={t('followUp.deleteAllHint')}
          onPress={confirmDeleteAll}
          testID="fu-delete-all"
        />
      </ExpandableCard>

      <LabelEditorSheet target={label} onClose={() => setLabel(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
