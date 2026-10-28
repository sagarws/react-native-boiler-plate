import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDay } from '@/features/life';
import type { IconName } from '@/shared/assets';
import { Icon } from '@/shared/components';
import { toDayKey } from '@/shared/utils/dayKey';
import { categoryColor, useTheme } from '@/theme';
import type { ContactRow } from '../services/views';
import type { Category, FollowUpStatus, Tag } from '../types';
import { formatPhone } from '../utils/phone';
import { TYPE_ICONS } from './ScheduleFields';

export interface ContactCardActions {
  onOpen: () => void;
  onCall: () => void;
  onWhatsApp: () => void;
  onDone?: () => void;
  onSchedule: () => void;
  onNote: () => void;
}

/** "Wed 28 Oct · 14:30" for a follow-up. */
export function whenLabel(day: string, time: string): string {
  return time ? `${formatDay(day)} · ${time}` : formatDay(day);
}

export function statusTone(
  status: FollowUpStatus | null,
  colors: ReturnType<typeof useTheme>['colors'],
) {
  switch (status) {
    case 'overdue':
      return colors.error;
    case 'due':
      return colors.warning;
    case 'completed':
      return colors.success;
    case 'scheduled':
      return colors.primary;
    default:
      return colors.textSecondary;
  }
}

/** Initials avatar or the contact's photo. */
export function ContactAvatar({
  name,
  photoUri,
  color,
  size = 44,
}: {
  name: string;
  photoUri: string;
  color: string;
  size?: number;
}) {
  const { colors, typography } = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (photoUri)
    return (
      <Image
        source={{ uri: photoUri }}
        style={box}
        accessibilityIgnoresInvertColors
      />
    );
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toLocaleUpperCase())
    .join('');
  return (
    <View style={[box, styles.center, { backgroundColor: color }]}>
      <Text style={[typography.label, { color: colors.primaryForeground }]}>
        {initials}
      </Text>
    </View>
  );
}

/**
 * One contact in a list: who, when the next follow-up is and its status,
 * category, tags, last contact and latest note — with one-tap actions.
 */
export function ContactCard({
  row,
  categories,
  tags,
  actions,
  testID,
}: {
  row: ContactRow;
  categories: Map<string, Category>;
  tags: Map<string, Tag>;
  actions: ContactCardActions;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const { contact, activity, status } = row;
  const category = categories.get(contact.categoryId);
  const contactTags = contact.tagIds
    .map(id => tags.get(id))
    .filter((x): x is Tag => !!x);
  const tone = statusTone(status, colors);
  const shown = activity ?? row.next;
  const caption = [typography.caption, { color: colors.textSecondary }];

  const action = (
    icon: IconName,
    label: string,
    onPress: () => void,
    id: string,
  ) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${contact.name}`}
      hitSlop={4}
      testID={`${testID}-${id}`}
      style={[
        styles.action,
        { borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Icon name={icon} size={18} color={colors.textPrimary} />
    </Pressable>
  );

  return (
    <Pressable
      testID={testID}
      onPress={actions.onOpen}
      accessibilityRole="button"
      accessibilityLabel={contact.name}
      accessibilityHint={t('followUp.openContactHint')}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: status ? tone : colors.border,
          borderRadius: radius.lg,
          padding: spacing.md,
          gap: spacing.sm,
        },
      ]}
    >
      <View style={[styles.row, { gap: spacing.md }]}>
        <ContactAvatar
          name={contact.name}
          photoUri={contact.photoUri}
          color={category ? categoryColor(category.color) : colors.primary}
        />
        <View style={styles.flex}>
          <View style={[styles.row, { gap: spacing.xs }]}>
            <Text
              style={[
                typography.label,
                styles.flexShrink,
                { color: colors.textPrimary },
              ]}
              numberOfLines={1}
            >
              {contact.name}
            </Text>
            {row.birthdayIn !== null && row.birthdayIn <= 7 ? (
              <Icon name="cake" size={14} color={colors.warning} />
            ) : null}
            {!contact.isActive ? (
              <Text style={caption}>· {t('followUp.inactive')}</Text>
            ) : null}
          </View>
          <Text style={caption} numberOfLines={1}>
            {formatPhone(contact)}
            {category ? ` · ${category.name}` : ''}
          </Text>
        </View>
        {status ? (
          <View
            style={[
              styles.pill,
              {
                borderColor: tone,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.sm,
              },
            ]}
          >
            <Text style={[typography.caption, { color: tone }]}>
              {t(`followUp.status_${status}`)}
            </Text>
          </View>
        ) : null}
      </View>

      {shown ? (
        <View style={[styles.row, { gap: spacing.xs }]}>
          <Icon name={TYPE_ICONS[shown.type]} size={14} color={tone} />
          <Text
            style={[
              typography.caption,
              styles.flex,
              { color: colors.textPrimary },
            ]}
            numberOfLines={1}
          >
            {shown.completedAt
              ? t('followUp.doneOn', {
                  when: formatDay(toDayKey(new Date(shown.completedAt))),
                  outcome: shown.outcome
                    ? t(`followUp.outcome_${shown.outcome}`)
                    : '',
                })
              : t('followUp.nextOn', {
                  when: whenLabel(shown.day, shown.time),
                })}
            {shown.purpose ? ` — ${shown.purpose}` : ''}
          </Text>
          {row.more ? <Text style={caption}>+{row.more}</Text> : null}
        </View>
      ) : (
        <Text style={caption}>{t('followUp.noFollowUp')}</Text>
      )}

      {row.latest ? (
        <Text style={caption} numberOfLines={1}>
          {row.latest}
        </Text>
      ) : null}

      {contactTags.length || row.lastContact ? (
        <View style={[styles.wrap, { gap: spacing.xs }]}>
          {contactTags.map(tag => (
            <View
              key={tag.id}
              style={[
                styles.tag,
                {
                  backgroundColor: categoryColor(tag.color),
                  borderRadius: radius.pill,
                  paddingHorizontal: spacing.sm,
                },
              ]}
            >
              <Text
                style={[
                  typography.caption,
                  { color: colors.primaryForeground },
                ]}
                numberOfLines={1}
              >
                {tag.name}
              </Text>
            </View>
          ))}
          {row.lastContact ? (
            <Text style={caption}>
              {t('followUp.lastContact', {
                when: formatDay(toDayKey(new Date(row.lastContact))),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.row, styles.actions, { gap: spacing.sm }]}>
        {action('phone', t('followUp.call'), actions.onCall, 'call')}
        {action(
          'messageCircle',
          t('followUp.whatsapp'),
          actions.onWhatsApp,
          'whatsapp',
        )}
        {action('stickyNote', t('followUp.addNote'), actions.onNote, 'note')}
        {action(
          'calendar',
          t('followUp.schedule'),
          actions.onSchedule,
          'schedule',
        )}
        {actions.onDone
          ? action(
              'circleCheck',
              t('followUp.markDone'),
              actions.onDone,
              'done',
            )
          : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderLeftWidth: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pill: { borderWidth: 1, paddingVertical: 2 },
  tag: { paddingVertical: 2 },
  actions: { justifyContent: 'flex-end' },
  action: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
