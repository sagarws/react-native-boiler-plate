import React, { useMemo } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDay, formatLongDay, SectionTitle } from '@/features/life';
import { ROUTES } from '@/navigation/routes';
import type { MainStackParamList } from '@/navigation/types';
import type { IconName } from '@/shared/assets';
import { Button, Card, EmptyState, Header, Icon } from '@/shared/components';
import { toDayKey } from '@/shared/utils/dayKey';
import { categoryColor, useTheme } from '@/theme';
import { useActionSheets } from '../components/ActionSheets';
import {
  ContactAvatar,
  statusTone,
  whenLabel,
} from '../components/ContactCard';
import { TYPE_ICONS } from '../components/ScheduleFields';
import { openEmail } from '../services/contactActions';
import { followUpNative } from '../services/native.service';
import {
  isOpen,
  nextBirthday,
  scheduledMs,
  statusOf,
} from '../services/status';
import { timelineOf, type TimelineItem } from '../services/views';
import { followUpActions, useFollowUpData, useNow } from '../hooks/useFollowUp';
import type { FollowUpActivity } from '../types';
import { formatPhone } from '../utils/phone';

/**
 * A contact's profile: details, quick actions, scheduled follow-ups and the
 * full timeline. Several follow-ups can be open at once; completed ones are
 * kept, never overwritten.
 */
export default function ContactDetailScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'FollowUpContact'>>();
  const data = useFollowUpData();
  const now = useNow();
  const sheets = useActionSheets();
  const contact = data.contacts.find(c => c.id === params.contactId);

  const open = useMemo(
    () =>
      data.activities
        .filter(a => a.contactId === params.contactId && isOpen(a))
        .sort((a, b) => scheduledMs(a) - scheduledMs(b)),
    [data.activities, params.contactId],
  );
  const timeline = useMemo(
    () => timelineOf(data, params.contactId),
    [data, params.contactId],
  );

  if (!contact) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <Header label={t('followUp.title')} />
        <EmptyState icon="users" title={t('followUp.contactMissing')} />
      </View>
    );
  }

  const category = data.categories.find(c => c.id === contact.categoryId);
  const tags = data.tags.filter(tag => contact.tagIds.includes(tag.id));
  const today = toDayKey(now);
  const lastContact = timeline.find(
    i =>
      i.kind === 'completed' || (i.kind === 'note' && i.note.kind !== 'note'),
  )?.at;
  const caption = [typography.caption, { color: colors.textSecondary }];
  const body = [typography.body, { color: colors.textPrimary }];

  const confirmDelete = () =>
    Alert.alert(
      t('followUp.deleteContactTitle'),
      t('followUp.deleteContactMessage', { name: contact.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('followUp.delete'),
          style: 'destructive',
          onPress: () => {
            followUpActions.deleteContact(contact.id);
            navigation.goBack();
          },
        },
      ],
    );

  const confirmCancel = (a: FollowUpActivity) =>
    Alert.alert(
      t('followUp.cancelFollowUpTitle'),
      t('followUp.cancelFollowUpMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('followUp.cancelFollowUp'),
          style: 'destructive',
          onPress: () => followUpActions.setCancelled(a.id, true),
        },
      ],
    );

  const quick = (
    icon: IconName,
    label: string,
    onPress: () => void,
    id: string,
  ) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`detail-${id}`}
      style={[styles.quick, { gap: spacing.xs }]}
    >
      <View
        style={[
          styles.quickIcon,
          { backgroundColor: colors.primarySoft, borderRadius: radius.pill },
        ]}
      >
        <Icon name={icon} size={22} color={colors.primaryText} />
      </View>
      <Text
        style={[typography.caption, { color: colors.textPrimary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );

  const detail = (icon: IconName, text: string, onPress?: () => void) => (
    <Pressable
      key={icon + text}
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'link' : 'text'}
      style={[styles.row, { gap: spacing.sm }]}
    >
      <Icon name={icon} size={16} color={colors.textSecondary} />
      <Text
        style={[
          body,
          styles.flex,
          onPress ? { color: colors.primaryText } : null,
        ]}
      >
        {text}
      </Text>
    </Pressable>
  );

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header
        label={contact.name}
        right={
          <Pressable
            onPress={() =>
              navigation.navigate(ROUTES.FOLLOW_UP_CONTACT_FORM, {
                contactId: contact.id,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={t('followUp.editContact')}
            style={styles.headerBtn}
            testID="detail-edit"
          >
            <Icon name="pencil" size={22} color={colors.textPrimary} />
          </Pressable>
        }
      />
      <ScrollView
        testID="contact-detail"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {sheets.element}
        <Card>
          <View style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.md }]}>
              <ContactAvatar
                name={contact.name}
                photoUri={contact.photoUri}
                color={
                  category ? categoryColor(category.color) : colors.primary
                }
                size={64}
              />
              <View style={styles.flex}>
                <Text style={[typography.title, { color: colors.textPrimary }]}>
                  {contact.name}
                </Text>
                <Text style={caption}>
                  {[
                    category?.name,
                    contact.isActive ? null : t('followUp.inactive'),
                  ]
                    .filter(Boolean)
                    .join(' · ') || t('followUp.noCategory')}
                </Text>
              </View>
            </View>
            {tags.length ? (
              <View style={[styles.wrap, { gap: spacing.xs }]}>
                {tags.map(tag => (
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
                    >
                      {tag.name}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={{ gap: spacing.sm }}>
              {detail('phone', formatPhone(contact), () =>
                sheets.call(contact, open[0]),
              )}
              {contact.email
                ? detail('mail', contact.email, () => {
                    void openEmail(contact.email);
                  })
                : null}
              {contact.organization
                ? detail('building2', contact.organization)
                : null}
              {contact.location ? detail('mapPin', contact.location) : null}
              {contact.birthDate
                ? detail(
                    'cake',
                    `${formatLongDay(contact.birthDate)} · ${
                      nextBirthday(contact.birthDate, today) === today
                        ? t('followUp.birthdayToday')
                        : t('followUp.nextBirthday', {
                            date: formatDay(
                              nextBirthday(contact.birthDate, today),
                            ),
                          })
                    }`,
                  )
                : null}
              {detail(
                'history',
                lastContact
                  ? t('followUp.lastContact', {
                      when: formatDay(toDayKey(new Date(lastContact))),
                    })
                  : t('followUp.neverContacted'),
              )}
            </View>
            {contact.notes ? (
              <Text style={caption}>{contact.notes}</Text>
            ) : null}
          </View>
        </Card>

        <View style={[styles.row, styles.quickRow]}>
          {quick(
            'phone',
            t('followUp.call'),
            () => sheets.call(contact, open[0]),
            'call',
          )}
          {quick(
            'messageCircle',
            t('followUp.whatsapp'),
            () => sheets.whatsapp(contact, open[0]),
            'whatsapp',
          )}
          {quick(
            'calendar',
            t('followUp.schedule'),
            () => sheets.schedule(contact),
            'schedule',
          )}
          {quick(
            'stickyNote',
            t('followUp.addNote'),
            () => sheets.note(contact),
            'note',
          )}
        </View>

        <SectionTitle>{t('followUp.scheduled')}</SectionTitle>
        {open.length ? (
          open.map(a => {
            const status = statusOf(a, now);
            const tone = statusTone(status, colors);
            return (
              <Card key={a.id} testID={`activity-${a.id}`}>
                <View style={{ gap: spacing.sm }}>
                  <View style={[styles.row, { gap: spacing.sm }]}>
                    <Icon name={TYPE_ICONS[a.type]} size={18} color={tone} />
                    <Text
                      style={[
                        typography.label,
                        styles.flex,
                        { color: colors.textPrimary },
                      ]}
                    >
                      {whenLabel(a.day, a.time)} ·{' '}
                      {t(`followUp.type_${a.type}`)}
                    </Text>
                    <Text style={[typography.caption, { color: tone }]}>
                      {t(`followUp.status_${status}`)}
                    </Text>
                  </View>
                  {a.purpose ? <Text style={caption}>{a.purpose}</Text> : null}
                  {a.reminder && data.settings.remindersEnabled ? (
                    <View style={[styles.row, { gap: spacing.xs }]}>
                      <Icon
                        name="bell"
                        size={12}
                        color={colors.textSecondary}
                      />
                      <Text style={caption}>{t('followUp.reminderOn')}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.wrap, { gap: spacing.sm }]}>
                    <Button
                      size="sm"
                      label={t('followUp.markDone')}
                      iconName="circleCheck"
                      onPress={() => sheets.complete(contact, a)}
                      testID={`activity-${a.id}-done`}
                    />
                    <Button
                      size="sm"
                      variant="soft"
                      label={t('followUp.reschedule')}
                      onPress={() => sheets.schedule(contact, a)}
                      testID={`activity-${a.id}-edit`}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      label={t('followUp.cancelFollowUp')}
                      onPress={() => confirmCancel(a)}
                      testID={`activity-${a.id}-cancel`}
                    />
                  </View>
                </View>
              </Card>
            );
          })
        ) : (
          <EmptyState
            compact
            icon="calendar"
            title={t('followUp.nothingScheduled')}
            action={{
              label: t('followUp.schedule'),
              onPress: () => sheets.schedule(contact),
            }}
          />
        )}

        <SectionTitle>{t('followUp.timeline')}</SectionTitle>
        {timeline.length ? (
          <View style={{ gap: spacing.sm }} testID="timeline">
            {timeline.map(item => (
              <TimelineRow
                key={`${item.kind}-${item.at}-${
                  'activity' in item
                    ? item.activity.id
                    : 'note' in item
                    ? item.note.id
                    : item.event.id
                }`}
                item={item}
              />
            ))}
          </View>
        ) : (
          <Text style={caption}>{t('followUp.timelineEmpty')}</Text>
        )}

        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <Button
            variant="soft"
            label={
              contact.isActive
                ? t('followUp.markInactive')
                : t('followUp.markActive')
            }
            onPress={() =>
              followUpActions.setContactActive(contact.id, !contact.isActive)
            }
            testID="detail-active"
          />
          <Button
            variant="danger"
            label={t('followUp.deleteContact')}
            onPress={confirmDelete}
            testID="detail-delete"
          />
        </View>
      </ScrollView>
    </View>
  );
}

/** One timeline entry; app-observed events are marked apart from user records. */
function TimelineRow({ item }: { item: TimelineItem }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const when = new Date(item.at);
  const stamp = `${formatDay(toDayKey(when))} ${String(
    when.getHours(),
  ).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  let icon: IconName = 'stickyNote';
  let title = '';
  let detail = '';
  let source: 'you' | 'app' = 'you';
  let attachment = null as null | { uri: string; name: string; mime: string };
  switch (item.kind) {
    case 'scheduled':
      icon = 'calendar';
      title = t('followUp.tl_scheduled', {
        when: whenLabel(item.activity.day, item.activity.time),
        type: t(`followUp.type_${item.activity.type}`),
      });
      detail = item.activity.purpose;
      break;
    case 'completed':
      icon = 'circleCheck';
      title = t('followUp.tl_completed', {
        outcome: item.activity.outcome
          ? t(`followUp.outcome_${item.activity.outcome}`)
          : '',
      });
      detail = item.activity.completionNote;
      break;
    case 'cancelled':
      icon = 'x';
      title = t('followUp.tl_cancelled', {
        when: whenLabel(item.activity.day, item.activity.time),
      });
      break;
    case 'note':
      icon =
        item.note.kind === 'call'
          ? 'phone'
          : item.note.kind === 'whatsapp'
          ? 'messageCircle'
          : item.note.kind === 'meeting'
          ? 'users'
          : 'stickyNote';
      title = t(`followUp.tl_note_${item.note.kind}`);
      detail = item.note.content;
      attachment = item.note.attachment;
      break;
    case 'event':
      source = 'app';
      icon =
        item.event.kind === 'rescheduled'
          ? 'rotateCw'
          : item.event.kind === 'dialer_opened'
          ? 'phone'
          : 'messageCircle';
      title = t(`followUp.tl_${item.event.kind}`);
      detail = item.event.detail;
      break;
  }
  return (
    <View style={[styles.row, styles.top, { gap: spacing.sm }]}>
      <Icon
        name={icon}
        size={16}
        color={source === 'app' ? colors.textSecondary : colors.primaryText}
      />
      <View style={styles.flex}>
        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {title}
        </Text>
        {detail ? (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {detail}
          </Text>
        ) : null}
        {attachment ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              void followUpNative.openAttachment(
                attachment!.uri,
                attachment!.mime,
              );
            }}
          >
            <Text style={[typography.caption, { color: colors.primaryText }]}>
              {t('followUp.openAttachment', { name: attachment.name })}
            </Text>
          </Pressable>
        ) : null}
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {stamp} · {t(source === 'app' ? 'followUp.byApp' : 'followUp.byYou')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  top: { alignItems: 'flex-start' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  flex: { flex: 1 },
  tag: { paddingVertical: 2 },
  headerBtn: { padding: 8 },
  quickRow: { justifyContent: 'space-around' },
  quick: { alignItems: 'center', width: 76 },
  quickIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
